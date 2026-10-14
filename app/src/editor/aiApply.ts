import type { Editor } from '@tiptap/core';
import { collectTextBlocks } from './blocks';

/**
 * The one way AI suggestions reach the manuscript: the author clicks "Use" on a version, and it replaces the passage
 * it was written for, as a single undoable step. If that passage has moved it's found again; if it has changed,
 * nothing is replaced.
 */

/** Where an AI request's passage was, and its exact text then. */
export interface TextAnchor {
  from: number;
  to: number;
  text: string;
}

/** The exact text between two positions, as the AI saw it. */
export function textAt(editor: Editor, from: number, to: number): string {
  return editor.state.doc.textBetween(from, to, '\n\n', '\n');
}

/** Finds the anchor's text again: where it was, or (inside one paragraph) its nearest copy elsewhere. */
function locate(editor: Editor, a: TextAnchor): { from: number; to: number } | null {
  const size = editor.state.doc.content.size;
  if (a.to <= size && textAt(editor, a.from, a.to) === a.text) return { from: a.from, to: a.to };
  if (a.text.includes('\n')) return null;
  let best: { from: number; to: number } | null = null;
  for (const b of collectTextBlocks(editor.state.doc)) {
    let i = b.text.indexOf(a.text);
    while (i >= 0) {
      const from = b.pos + i;
      if (!best || Math.abs(from - a.from) < Math.abs(best.from - a.from)) best = { from, to: from + a.text.length };
      i = b.text.indexOf(a.text, i + 1);
    }
  }
  return best;
}

/** Replaces the anchored passage with the chosen version. Returns false (changing nothing) if the passage changed. */
export function replaceAnchored(editor: Editor, anchor: TextAnchor, replacement: string): boolean {
  const at = locate(editor, anchor);
  if (!at) return false;
  const { state } = editor;
  const $from = state.doc.resolve(at.from);
  const $to = state.doc.resolve(at.to);
  const text = replacement.trim();
  let tr = state.tr;
  if ($from.sameParent($to)) {
    // Within one paragraph: plain text keeps the paragraph (and its style) intact.
    tr = tr.insertText(text.replace(/\s*\n+\s*/g, ' '), at.from, at.to);
  } else {
    // Across paragraphs: one paragraph per blank-line-separated part.
    const { schema } = state;
    const paras = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => schema.nodes.paragraph.create(null, schema.text(p)));
    tr = tr.replaceWith($from.before(), $to.after(), paras);
  }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
