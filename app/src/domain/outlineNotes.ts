import type { DocJson } from './schema';
import { inlinePoints } from './planChecklist';

/**
 * Planning bullets typed into a scene ("- Finn helps her clean up") are notes, not story: they'd be printed in
 * exports. These pull them out of the scene's text so they can live in the scene's Notes instead. Pure.
 */

interface PmNode {
  type: string;
  text?: string;
  content?: PmNode[];
}

const BULLET = /^\s*[-*•–]\s+\S/;
const textOf = (n: PmNode): string => (n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(textOf).join(''));

/** How many plan points these bullet lines hold ("- A - B - C" typed on one line is three). */
export function planPointCount(lines: readonly string[]): number {
  return lines.reduce((n, l) => n + inlinePoints(l.replace(/^\s*[-*•–]\s+/, '')).length, 0);
}

/** The scene's planning lines: top-level paragraphs that start with a dash or bullet (only when they hold two or more points). */
export function outlineLines(doc: DocJson | null | undefined): string[] {
  const blocks = ((doc as PmNode | null)?.content ?? []).filter((b) => b.type === 'paragraph');
  const lines = blocks.map(textOf).filter((t) => BULLET.test(t));
  return planPointCount(lines) >= 2 ? lines.map((l) => l.trim()) : [];
}

/** The document without its planning lines (an empty paragraph is left if nothing else remains). */
export function withoutOutline(doc: DocJson): DocJson {
  const d = doc as PmNode;
  if (outlineLines(doc).length === 0) return doc;
  let content = (d.content ?? []).filter((b) => !(b.type === 'paragraph' && BULLET.test(textOf(b))));
  // Blank paragraphs left at the start (where the plan was) go too.
  while (content.length && content[0].type === 'paragraph' && !textOf(content[0]).trim()) content = content.slice(1);
  return { ...d, content: content.length ? content : [{ type: 'paragraph' }] } as DocJson;
}

/** The scene's notes with the planning lines added under a heading, keeping what was there. */
export function notesWithOutline(notes: string, lines: readonly string[]): string {
  const block = ['Plan (moved from the text):', ...lines].join('\n');
  return notes.trim() ? `${notes.trimEnd()}\n\n${block}` : block;
}
