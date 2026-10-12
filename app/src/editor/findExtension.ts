import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { collectTextBlocks } from './blocks';
import { escapeRegExp } from '../domain/text';

export interface FindMatch {
  from: number;
  to: number;
}

interface FindState {
  query: string;
  caseSensitive: boolean;
  matches: FindMatch[];
  current: number;
  deco: DecorationSet;
}

export const findKey = new PluginKey<FindState>('find');

export function findMatches(doc: EditorState['doc'], query: string, caseSensitive: boolean): FindMatch[] {
  if (!query) return [];
  const re = new RegExp(escapeRegExp(query), caseSensitive ? 'g' : 'gi');
  const out: FindMatch[] = [];
  for (const b of collectTextBlocks(doc)) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(b.text))) {
      out.push({ from: b.pos + m.index, to: b.pos + m.index + m[0].length });
      if (out.length > 5000) return out;
    }
  }
  return out;
}

function deco(doc: EditorState['doc'], matches: FindMatch[], current: number) {
  return DecorationSet.create(
    doc,
    matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'find-hit find-current' : 'find-hit' })),
  );
}

export const Find = Extension.create({
  name: 'find',
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: (_, s) => ({ query: '', caseSensitive: false, matches: [], current: 0, deco: DecorationSet.create(s.doc, []) }),
          apply(tr, prev, _o, state) {
            const meta = tr.getMeta(findKey) as Partial<Pick<FindState, 'query' | 'caseSensitive' | 'current'>> | undefined;
            if (!meta && !tr.docChanged) return prev;
            const query = meta?.query ?? prev.query;
            const caseSensitive = meta?.caseSensitive ?? prev.caseSensitive;
            const matches = findMatches(state.doc, query, caseSensitive);
            const current = Math.min(meta?.current ?? prev.current, Math.max(0, matches.length - 1));
            return { query, caseSensitive, matches, current, deco: deco(state.doc, matches, current) };
          },
        },
        props: {
          decorations: (state) => findKey.getState(state)?.deco,
        },
      }),
    ];
  },
});
