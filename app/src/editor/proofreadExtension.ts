import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CATEGORY_LABELS, type Suggestion } from '../proofreading/types';

/** A suggestion placed in the document. Positions are mapped through edits; overlapping edits drop it. */
export interface PlacedSuggestion extends Suggestion {
  key: string;
  from: number;
  to: number;
}

interface PluginState {
  items: PlacedSuggestion[];
  deco: DecorationSet;
  activeKey: string | null;
}

export const proofreadKey = new PluginKey<PluginState>('proofread');

type Meta = { type: 'set'; items: PlacedSuggestion[] } | { type: 'remove'; key: string } | { type: 'active'; key: string | null };

const SEVERITY_RANK = { error: 0, warning: 1, style: 2 } as const;
const SEVERITY_LABEL = { error: 'Likely error', warning: 'Check', style: 'Style' } as const;

/** Most useful first: errors before style notes, fixable before not. */
function byUsefulness(a: PlacedSuggestion, b: PlacedSuggestion) {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || Number(!a.replacements.length) - Number(!b.replacements.length) || a.from - b.from;
}

/** Hover text saying why the words are marked. */
export function suggestionTooltip(items: PlacedSuggestion[]): string {
  const lines = items.map((s) => {
    const fix = s.replacements.length ? ` Suggested: ${s.replacements.map((r) => (r === '' ? '(remove)' : r === ' ' ? '(single space)' : `“${r}”`)).join(', ')}.` : '';
    return `${SEVERITY_LABEL[s.severity]} · ${CATEGORY_LABELS[s.category]}: ${s.message}${fix}`;
  });
  return [...lines, 'Click for options.'].join('\n');
}

/**
 * One decoration per stretch of text with the same set of suggestions. Overlapping inline decorations would
 * otherwise be merged by the view into one span keeping an arbitrary id and tooltip.
 */
function build(doc: EditorState['doc'], items: PlacedSuggestion[], activeKey: string | null) {
  const cuts = [...new Set(items.flatMap((s) => [s.from, s.to]))].sort((a, b) => a - b);
  const sorted = items.slice().sort((a, b) => a.from - b.from);
  const decos: Decoration[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    const here: PlacedSuggestion[] = [];
    for (const s of sorted) {
      if (s.from > from) break;
      if (s.to >= to) here.push(s);
    }
    if (!here.length) continue;
    here.sort(byUsefulness);
    decos.push(
      Decoration.inline(
        from,
        to,
        {
          class: `pr pr-${here[0].severity}${here.some((s) => s.key === activeKey) ? ' pr-active' : ''}`,
          'data-sid': here[0].key,
          title: suggestionTooltip(here),
        },
        { key: here.map((s) => s.key).join(' ') },
      ),
    );
  }
  return DecorationSet.create(doc, decos);
}

export const Proofread = Extension.create({
  name: 'proofread',
  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: proofreadKey,
        state: {
          init: (_, state) => ({ items: [], deco: DecorationSet.create(state.doc, []), activeKey: null }),
          apply(tr: Transaction, prev, _old, state) {
            const meta = tr.getMeta(proofreadKey) as Meta | undefined;
            let { items, activeKey } = prev;
            if (meta?.type === 'set') items = meta.items;
            else if (meta?.type === 'remove') items = items.filter((s) => s.key !== meta.key);
            else if (meta?.type === 'active') activeKey = meta.key;
            else if (tr.docChanged) {
              const next: PlacedSuggestion[] = [];
              for (const s of items) {
                const from = tr.mapping.mapResult(s.from, 1);
                const to = tr.mapping.mapResult(s.to, -1);
                // Drop suggestions whose text was edited: they are stale.
                if (from.deleted || to.deleted || to.pos <= from.pos) continue;
                if (state.doc.textBetween(from.pos, to.pos, '\n') !== s.original) continue;
                next.push({ ...s, from: from.pos, to: to.pos });
              }
              // Typing elsewhere in the scene: move the existing underlines instead of rebuilding them all.
              if (next.length === items.length) return { items: next, activeKey, deco: prev.deco.map(tr.mapping, state.doc) };
              items = next;
            } else {
              return prev;
            }
            return { items, activeKey, deco: build(state.doc, items, activeKey) };
          },
        },
        props: {
          decorations(state) {
            return proofreadKey.getState(state)?.deco;
          },
        },
      }),
    ];
  },
});

export function getSuggestions(state: EditorState): PlacedSuggestion[] {
  return proofreadKey.getState(state)?.items ?? [];
}

/**
 * Every suggestion touching [from, to), most useful first. A click is resolved by position because one
 * marked stretch can carry several suggestions.
 */
export function suggestionsAt(state: EditorState, from: number, to: number): PlacedSuggestion[] {
  return getSuggestions(state)
    .filter((s) => s.from < to && from < s.to)
    .sort(byUsefulness);
}

/**
 * Apply a replacement only if the document still contains exactly the flagged text.
 * Returns false (and changes nothing) when the suggestion is stale.
 */
export function applyPlaced(state: EditorState, dispatch: (tr: Transaction) => void, s: PlacedSuggestion, replacement: string): boolean {
  if (s.to > state.doc.content.size) return false;
  if (state.doc.textBetween(s.from, s.to, '\n') !== s.original) return false;
  let from = s.from;
  // Removing a word: take one neighbouring space with it so "was very tired" becomes "was tired", not "was  tired".
  if (replacement === '' && from > 0 && state.doc.textBetween(from - 1, from) === ' ' && /^[ ,.;:!?]?$/.test(state.doc.textBetween(s.to, Math.min(s.to + 1, state.doc.content.size)))) from--;
  const tr = state.tr.insertText(replacement, from, s.to);
  tr.setMeta(proofreadKey, { type: 'remove', key: s.key } satisfies Meta);
  dispatch(tr);
  return true;
}

export function setSuggestionsMeta(items: PlacedSuggestion[]): Meta {
  return { type: 'set', items };
}

export function removeSuggestionMeta(key: string): Meta {
  return { type: 'remove', key };
}

export function activeSuggestionMeta(key: string | null): Meta {
  return { type: 'active', key };
}
