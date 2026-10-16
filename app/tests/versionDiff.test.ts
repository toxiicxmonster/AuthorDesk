import { describe, expect, it } from 'vitest';
import { versionDiff, wordChanges } from '../src/domain/versionDiff';

describe('comparing two versions of a scene', () => {
  it('marks removed and added words inside a rewritten paragraph', () => {
    const p = wordChanges('I hold back tears as the ringing stops.', 'I held back tears as the ringing stopped.');
    expect(p.filter((x) => x.kind === 'del').map((x) => x.text.trim())).toEqual(['hold', 'stops']);
    expect(p.filter((x) => x.kind === 'add').map((x) => x.text.trim())).toEqual(['held', 'stopped']);
    expect(p.filter((x) => x.kind !== 'del').map((x) => x.text).join('')).toBe('I held back tears as the ringing stopped.');
    expect(p.filter((x) => x.kind !== 'add').map((x) => x.text).join('')).toBe('I hold back tears as the ringing stops.');
  });

  it('matches paragraphs, so unchanged ones stay unchanged and new ones are additions', () => {
    const before = 'One paragraph.\n\nThe second one, as it was.\n\nThird.';
    const after = 'One paragraph.\n\nThe second one, as it is now.\n\nThird.\n\nA brand new ending.';
    const d = versionDiff(before, after);
    expect(d.blocks.map((b) => b.kind)).toEqual(['same', 'changed', 'same', 'added']);
    expect(d.added).toBe(6); // "is now" + "A brand new ending"
    expect(d.removed).toBe(1); // only "was": "it" stays
  });

  it('handles a full-length scene quickly', () => {
    const para = (i: number) => `Paragraph ${i}: the harbour lights flickered as the last boat came in, and she watched the water fold over itself.`;
    const before = Array.from({ length: 200 }, (_, i) => para(i)).join('\n\n');
    const after = before.replace('Paragraph 100: the harbour', 'Paragraph 100: the old harbour');
    const t = performance.now();
    const d = versionDiff(before, after);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
  });
});
