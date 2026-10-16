/**
 * What changed between two versions of a scene: paragraphs are matched first (so a long scene compares quickly),
 * then each rewritten paragraph is compared word by word, with removed and added words both marked. Pure.
 */

export type Piece = { text: string; kind: 'same' | 'add' | 'del' };

export type DiffBlock =
  | { kind: 'same'; text: string }
  | { kind: 'added'; text: string }
  | { kind: 'removed'; text: string }
  | { kind: 'changed'; pieces: Piece[] };

export interface VersionDiff {
  blocks: DiffBlock[];
  added: number;
  removed: number;
}

const paragraphs = (s: string) =>
  s
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
const tokens = (s: string) => s.match(/[\p{L}\p{N}'’-]+|[^\p{L}\p{N}'’-]+/gu) ?? [];
const wordCount = (s: string) => (s.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;

/** Longest-common-subsequence table for two lists. */
function lcsTable<T>(a: readonly T[], b: readonly T[]): number[][] {
  const t: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  return t;
}

/** Word-level changes inside one rewritten paragraph. */
export function wordChanges(before: string, after: string): Piece[] {
  const a = tokens(before);
  const b = tokens(after);
  if (a.length * b.length > 600_000) return [{ text: before, kind: 'del' }, { text: ' ', kind: 'same' }, { text: after, kind: 'add' }];
  const t = lcsTable(a, b);
  const out: Piece[] = [];
  const push = (text: string, kind: Piece['kind']) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  // Where words were replaced, the old ones come first ("~~the~~ that"), as people read a correction.
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push(a[i], 'same');
      i++;
      j++;
    } else if (i < a.length && (j >= b.length || t[i + 1][j] >= t[i][j + 1])) {
      push(a[i], 'del');
      i++;
    } else {
      push(b[j], 'add');
      j++;
    }
  }
  return out;
}

export function versionDiff(before: string, after: string): VersionDiff {
  const a = paragraphs(before);
  const b = paragraphs(after);
  const t = lcsTable(a, b);
  const blocks: DiffBlock[] = [];
  let added = 0;
  let removed = 0;
  let gone: string[] = [];
  let come: string[] = [];
  // A run of removed and added paragraphs between two unchanged ones: pair them up as rewrites.
  const flush = () => {
    const n = Math.max(gone.length, come.length);
    for (let k = 0; k < n; k++) {
      const x = gone[k];
      const y = come[k];
      if (x !== undefined && y !== undefined) {
        const pieces = wordChanges(x, y);
        for (const p of pieces) {
          if (p.kind === 'add') added += wordCount(p.text);
          if (p.kind === 'del') removed += wordCount(p.text);
        }
        blocks.push({ kind: 'changed', pieces });
      } else if (x !== undefined) {
        removed += wordCount(x);
        blocks.push({ kind: 'removed', text: x });
      } else if (y !== undefined) {
        added += wordCount(y);
        blocks.push({ kind: 'added', text: y });
      }
    }
    gone = [];
    come = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      blocks.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || t[i][j + 1] >= t[i + 1][j])) {
      come.push(b[j]);
      j++;
    } else {
      gone.push(a[i]);
      i++;
    }
  }
  flush();
  return { blocks, added, removed };
}
