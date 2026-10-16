import { describe, expect, it } from 'vitest';
import { buildOutline } from '../src/domain/outlineExport';
import type { Chapter, ReferenceEntry, Scene } from '../src/domain/schema';

const chapter = (title: string, summary: string) => ({ id: title, title, summary }) as unknown as Chapter;
const scene = (p: Partial<Scene>) => ({ title: 'Scene 1', summary: '', notes: '', timeMarker: '', wordCount: 0, status: 'drafting', povCharacterId: null, locationId: null, ...p }) as unknown as Scene;
const refs = [{ id: 'w', name: 'Winnie Hartley' }] as unknown as ReferenceEntry[];

describe('outline export', () => {
  it('lists summaries, details and plan points, counting what is ticked off', () => {
    const o = buildOutline(
      [
        { chapter: chapter('Chapter 1', '- [x] Winnie finds out Grandma died\n- Funeral happens'), scenes: [scene({ povCharacterId: 'w', timeMarker: 'day 1 7:32 P.M.', wordCount: 1098, notes: 'Tone: raw\n- Jace ignores the call' })] },
        { chapter: chapter('', ''), scenes: [] },
      ],
      refs,
    );
    expect(o.points).toBe(3);
    expect(o.done).toBe(1);
    expect(o.chapters[0].summary).toEqual([
      { kind: 'point', text: 'Winnie finds out Grandma died', done: true },
      { kind: 'point', text: 'Funeral happens', done: false },
    ]);
    expect(o.chapters[0].scenes[0].details).toBe('POV: Winnie Hartley · Time: day 1 7:32 P.M. · 1,098 words · Drafting');
    expect(o.chapters[0].scenes[0].notes[0]).toEqual({ kind: 'text', text: 'Tone: raw' });
    expect(o.chapters[1].title).toBe('Chapter 2');
  });
});

describe('outline export: scenes', () => {
  it('shows plan lines still in the text, and leaves out scenes with nothing yet', () => {
    const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const content = { type: 'doc', content: [p('- Winnie gets the keys'), p('- Finn stops, grumpy')] } as never;
    const o = buildOutline([{ chapter: chapter('Chapter 2', ''), scenes: [scene({ content, wordCount: 9 }), scene({ title: 'Scene 2' })] }], refs);
    expect(o.chapters[0].scenes).toHaveLength(1);
    expect(o.chapters[0].scenes[0].inText.map((l) => l.text)).toEqual(['Winnie gets the keys', 'Finn stops, grumpy']);
    expect(o.points).toBe(2);
  });

  it('splits a one-line plan in the text and skips points the chapter plan already lists', () => {
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '- Winnie wearing Jace number - Finn catches a glimpse of her - He was surprised' }] }] } as never;
    const o = buildOutline([{ chapter: chapter('Chapter 3', '- [x] Finn catches a glimpse of her'), scenes: [scene({ content, wordCount: 14 })] }], refs);
    expect(o.chapters[0].scenes[0].inText.map((l) => l.text)).toEqual(['Winnie wearing Jace number', 'He was surprised']);
    expect([o.points, o.done]).toEqual([3, 1]);
  });
});
