import type { DocJson } from './schema';

const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export function countWords(text: string): number {
  if (!text) return 0;
  return text.match(WORD_RE)?.length ?? 0;
}

export function countChars(text: string, includeSpaces = true): number {
  return includeSpaces ? [...text].length : [...text.replace(/\s/g, '')].length;
}

export interface PmNode {
  type: string;
  text?: string;
  content?: PmNode[];
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/** Extract plain text from a TipTap JSON doc; blocks are separated by blank lines. */
export function docToPlainText(doc: DocJson | PmNode | null | undefined): string {
  if (!doc) return '';
  const blocks: string[] = [];
  const walk = (node: PmNode) => {
    if (node.type === 'horizontalRule') {
      blocks.push('* * *');
      return;
    }
    if (node.type === 'paragraph' || node.type === 'heading') {
      blocks.push(inlineText(node));
      return;
    }
    node.content?.forEach(walk);
  };
  walk(doc as PmNode);
  return blocks.join('\n\n').trim();
}

export function inlineText(node: PmNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(inlineText).join('');
}

/** Collect reference ids from refLink marks in a doc. */
export function docReferenceIds(doc: DocJson | PmNode | null | undefined): string[] {
  const ids = new Set<string>();
  const walk = (node: PmNode) => {
    node.marks?.forEach((m) => {
      if (m.type === 'refLink' && typeof m.attrs?.refId === 'string') ids.add(m.attrs.refId);
    });
    node.content?.forEach(walk);
  };
  if (doc) walk(doc as PmNode);
  return [...ids];
}

export function emptyDoc(): DocJson {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** Build a doc from plain text paragraphs (used by imports and tests). */
export function plainTextToDoc(text: string): DocJson {
  const paras = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return {
    type: 'doc',
    content: paras.map((p) =>
      p.trim() === '* * *' || p.trim() === '***' || p.trim() === '#'
        ? { type: 'horizontalRule' }
        : p.trim()
          ? { type: 'paragraph', content: [{ type: 'text', text: p.replace(/\n/g, ' ').trim() }] }
          : { type: 'paragraph' },
    ),
  };
}

/** Small, case-insensitive snippet around the first match. */
export function snippet(text: string, query: string, radius = 60): string | null {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i < 0) return null;
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + query.length + radius);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ') + (end < text.length ? '…' : '');
}

/**
 * Edit distance where swapping two neighbouring letters counts as one edit ("Elsei" → "Elsie" is 1),
 * since transpositions are the most common typing mistake (optimal string alignment distance).
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let before: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], before[j - 2] + 1);
    }
    before = prev;
    prev = cur;
  }
  return prev[n];
}

export function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Fast non-cryptographic hash (FNV-1a) for detecting text changes. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
