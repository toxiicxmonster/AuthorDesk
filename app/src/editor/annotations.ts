import { Mark, mergeAttributes } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';

/**
 * The author's own marks on the page: coloured highlights and comments (notes pinned to a stretch of text, like the
 * comments in Word or Google Docs). Both are for the author only: they're saved with the scene but left out of every
 * export, and they don't change the words.
 */

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'orange'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
export const HIGHLIGHT_LABELS: Record<HighlightColor, string> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  purple: 'Purple',
  orange: 'Orange',
};

export interface CommentAttrs {
  id: string;
  text: string;
  /** Who wrote it, for comments that came from a Word file; empty for the author's own. */
  author: string;
  /** When it was written (ISO). */
  at: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlight: {
      setHighlight: (color: HighlightColor) => ReturnType;
      unsetHighlight: () => ReturnType;
    };
    comment: {
      addComment: (text: string) => ReturnType;
      updateComment: (id: string, text: string) => ReturnType;
      removeComment: (id: string) => ReturnType;
    };
  }
}

export const Highlight = Mark.create({
  name: 'highlight',
  addAttributes() {
    return {
      color: {
        default: 'yellow',
        parseHTML: (el) => el.getAttribute('data-hl') ?? 'yellow',
        renderHTML: (attrs) => ({ 'data-hl': attrs.color, class: `hl hl-${attrs.color}` }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'mark[data-hl]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['mark', HTMLAttributes, 0];
  },
  addCommands() {
    return {
      setHighlight:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/** Every place a comment's mark sits in the document (one comment can cover several text pieces). */
function commentRanges(doc: PmNode, id: string): { from: number; to: number; attrs: CommentAttrs }[] {
  const out: { from: number; to: number; attrs: CommentAttrs }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const m = node.marks.find((x) => x.type.name === 'comment' && x.attrs.id === id);
    if (m) out.push({ from: pos, to: pos + node.nodeSize, attrs: m.attrs as CommentAttrs });
  });
  return out;
}

export const Comment = Mark.create({
  name: 'comment',
  inclusive: false,
  // Comments may overlap each other (and anything else).
  excludes: '',
  addAttributes() {
    return {
      id: { default: '', parseHTML: (el) => el.getAttribute('data-comment-id') ?? '', renderHTML: (a) => ({ 'data-comment-id': a.id }) },
      text: { default: '', parseHTML: (el) => el.getAttribute('data-comment') ?? '', renderHTML: (a) => ({ 'data-comment': a.text }) },
      author: { default: '', parseHTML: (el) => el.getAttribute('data-comment-author') ?? '', renderHTML: (a) => (a.author ? { 'data-comment-author': a.author } : {}) },
      at: { default: '', parseHTML: (el) => el.getAttribute('data-comment-at') ?? '', renderHTML: (a) => (a.at ? { 'data-comment-at': a.at } : {}) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'cmt' }), 0];
  },
  addCommands() {
    return {
      addComment:
        (text) =>
        ({ commands }) =>
          commands.setMark(this.name, { id: crypto.randomUUID(), text, author: '', at: new Date().toISOString() }),
      updateComment:
        (id, text) =>
        ({ state, tr, dispatch }) => {
          const ranges = commentRanges(state.doc, id);
          if (!ranges.length) return false;
          if (dispatch) {
            const type = state.schema.marks.comment;
            for (const r of ranges) {
              tr.removeMark(r.from, r.to, type.create(r.attrs));
              tr.addMark(r.from, r.to, type.create({ ...r.attrs, text }));
            }
          }
          return true;
        },
      removeComment:
        (id) =>
        ({ state, tr, dispatch }) => {
          const ranges = commentRanges(state.doc, id);
          if (!ranges.length) return false;
          if (dispatch) for (const r of ranges) tr.removeMark(r.from, r.to, state.schema.marks.comment.create(r.attrs));
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      // Like Word and Google Docs.
      'Mod-Alt-m': () => {
        window.dispatchEvent(new CustomEvent('authordesk:add-comment'));
        return true;
      },
    };
  },
});

export interface SceneComment extends CommentAttrs {
  from: number;
  to: number;
  /** The words it's attached to. */
  quote: string;
}

/** The comments in a document, in reading order, each with the words it covers. */
export function listComments(doc: PmNode): SceneComment[] {
  const byId = new Map<string, SceneComment>();
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if (m.type.name !== 'comment') continue;
      const a = m.attrs as CommentAttrs;
      const cur = byId.get(a.id);
      if (cur) {
        cur.quote += (pos > cur.to ? ' ' : '') + (node.text ?? '');
        cur.to = pos + node.nodeSize;
      } else byId.set(a.id, { ...a, from: pos, to: pos + node.nodeSize, quote: node.text ?? '' });
    }
  });
  return [...byId.values()].sort((a, b) => a.from - b.from);
}

/** Comment and highlight counts in a saved scene (its TipTap JSON), without an editor. */
export function annotationCounts(doc: unknown): { comments: number; highlights: number } {
  const ids = new Set<string>();
  let highlights = 0;
  const walk = (n: { type?: string; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: unknown[] }, prevLit: { v: boolean }) => {
    if (n.type === 'text') {
      const lit = !!n.marks?.some((m) => m.type === 'highlight');
      if (lit && !prevLit.v) highlights++;
      prevLit.v = lit;
      for (const m of n.marks ?? []) if (m.type === 'comment' && m.attrs?.id) ids.add(String(m.attrs.id));
      return;
    }
    const inner = { v: false };
    for (const c of (n.content ?? []) as (typeof n)[]) walk(c, inner);
  };
  if (doc && typeof doc === 'object') walk(doc as never, { v: false });
  return { comments: ids.size, highlights };
}
