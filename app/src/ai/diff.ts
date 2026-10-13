/** A word-level comparison of a suggestion with the original, for highlighting what changed (display only). */
export interface DiffPart {
  text: string;
  changed: boolean;
}

/** Splits into words and the spaces/punctuation between them, so the parts join back into the exact text. */
const tokens = (s: string) => s.match(/[\p{L}\p{N}'’-]+|[^\p{L}\p{N}'’-]+/gu) ?? [];

/** Marks the parts of `after` that aren't in `before` (longest common subsequence over words). */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  if (a.length * b.length > 250_000) return [{ text: after, changed: true }];
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (text: string, changed: boolean) => {
    const last = out[out.length - 1];
    if (last && last.changed === changed) last.text += text;
    else out.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      push(b[j], false);
      i++;
      j++;
    } else if (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else {
      push(b[j], !/^\s+$/.test(b[j]));
      j++;
    }
  }
  return out;
}
