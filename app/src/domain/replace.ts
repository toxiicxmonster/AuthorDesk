import type { DocJson } from './schema';

/**
 * Find and replace across scenes, working on the stored editor documents so bold, italic and links survive. A match
 * may run across differently styled pieces of text ("Jace" with only "J" in italics); its replacement takes the
 * style of where the match starts. Matches never run across a line break or from one paragraph into the next. Pure.
 */

export interface ReplaceOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface DocMatch {
  /** Which paragraph (in reading order) and where in its text. */
  block: number;
  start: number;
  end: number;
  text: string;
  /** The paragraph's text, for showing the match in context. */
  blockText: string;
}

interface PmNode {
  type: string;
  text?: string;
  marks?: unknown[];
  content?: PmNode[];
  attrs?: Record<string, unknown>;
}

const SEPARATOR = '￼'; // stands in for non-text inline nodes (line breaks, images)
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function matcher(query: string, opts: ReplaceOptions): RegExp | null {
  if (!query) return null;
  let src = escape(query);
  if (opts.wholeWord) src = `(?<![\\p{L}\\p{N}'’])${src}(?![\\p{L}\\p{N}])`;
  return new RegExp(src, `gu${opts.caseSensitive ? '' : 'i'}`);
}

/** Paragraph-like nodes (those holding text directly), in reading order. */
function textBlocks(node: PmNode, out: PmNode[] = []): PmNode[] {
  const kids = node.content ?? [];
  if (kids.some((k) => k.type === 'text')) out.push(node);
  else for (const k of kids) textBlocks(k, out);
  return out;
}

const blockString = (b: PmNode) => (b.content ?? []).map((k) => (k.type === 'text' ? (k.text ?? '') : SEPARATOR)).join('');

export function findInDoc(doc: DocJson | null | undefined, query: string, opts: ReplaceOptions): DocMatch[] {
  const re = matcher(query, opts);
  if (!re || !doc) return [];
  const out: DocMatch[] = [];
  textBlocks(doc as PmNode).forEach((b, block) => {
    const s = blockString(b);
    for (const m of s.matchAll(re)) {
      if (m[0].includes(SEPARATOR)) continue;
      out.push({ block, start: m.index!, end: m.index! + m[0].length, text: m[0], blockText: s.replace(new RegExp(SEPARATOR, 'g'), ' ') });
    }
  });
  return out;
}

/**
 * The replacement for one match: with "match case" off, a match that starts with a capital (a sentence start, a
 * name) keeps it, and an all-capitals match stays in capitals.
 */
export function caseLike(match: string, replacement: string, caseSensitive: boolean): string {
  if (caseSensitive || !replacement) return replacement;
  const letters = match.replace(/[^\p{L}]/gu, '');
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return replacement.toUpperCase();
  const first = match.match(/\p{L}/u)?.[0];
  if (first && first !== first.toLowerCase() && replacement[0] === replacement[0].toLowerCase()) return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

/** Replaces [start, end) of a paragraph's text, keeping the styles around it. */
function spliceBlock(block: PmNode, start: number, end: number, text: string): void {
  const kids = block.content ?? [];
  const out: PmNode[] = [];
  let pos = 0;
  let inserted = false;
  for (const k of kids) {
    const len = k.type === 'text' ? (k.text ?? '').length : 1;
    const from = pos;
    const to = pos + len;
    pos = to;
    if (k.type !== 'text' || to <= start || from >= end) {
      out.push(k);
      continue;
    }
    // This piece overlaps the match: keep what's outside it, put the replacement where the match starts.
    const t = k.text ?? '';
    const before = t.slice(0, Math.max(0, start - from));
    const after = t.slice(Math.max(0, Math.min(len, end - from)));
    const middle = !inserted && start >= from ? text : '';
    if (middle) inserted = true;
    const merged = before + middle + after;
    if (merged) out.push({ ...k, text: merged });
  }
  block.content = out;
}

/**
 * Replaces matches in a copy of `doc`. `keep(i)` says whether the i-th match (in findInDoc order) is replaced;
 * by default all are. Returns the new document and how many were replaced.
 */
export function replaceInDoc(doc: DocJson, query: string, replacement: string, opts: ReplaceOptions, keep: (i: number) => boolean = () => true): { doc: DocJson; count: number } {
  const copy = JSON.parse(JSON.stringify(doc)) as PmNode;
  const matches = findInDoc(copy as DocJson, query, opts);
  const blocks = textBlocks(copy);
  let count = 0;
  // Right to left within each paragraph, so earlier offsets stay valid.
  for (let i = matches.length - 1; i >= 0; i--) {
    if (!keep(i)) continue;
    const m = matches[i];
    spliceBlock(blocks[m.block], m.start, m.end, caseLike(m.text, replacement, opts.caseSensitive));
    count++;
  }
  return { doc: copy as DocJson, count };
}
