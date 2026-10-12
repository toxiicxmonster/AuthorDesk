import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Suggestion } from '../proofreading/types';

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

function build(doc: EditorState['doc'], items: PlacedSuggestion[], activeKey: string | null) {
  return DecorationSet.create(
    doc,
    items.map((s) =>
      Decoration.inline(
        s.from,
        s.to,
        {
          class: `pr pr-${s.severity}${s.key === activeKey ? ' pr-active' : ''}`,
          'data-sid': s.key,
        },
        { key: s.key },
      ),
    ),
  );
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
 * Apply a replacement only if the document still contains exactly the flagged text.
 * Returns false (and changes nothing) when the suggestion is stale.
 */
export function applyPlaced(state: EditorState, dispatch: (tr: Transaction) => void, s: PlacedSuggestion, replacement: string): boolean {
  if (s.to > state.doc.content.size) return false;
  if (state.doc.textBetween(s.from, s.to, '\n') !== s.original) return false;
  const tr = state.tr.insertText(replacement, s.from, s.to);
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
