import { describe, expect, it } from 'vitest';
import { characterVoices } from '../src/review/voices';
import type { ReferenceEntry } from '../src/domain/schema';

const ch = (id: string, name: string, aliases: string[] = []) => ({ id, name, aliases, type: 'character', archivedAt: null }) as unknown as ReferenceEntry;
const scene = (sceneId: string, chapterIndex: number, paragraphs: string[], povId: string | null = null) => ({ sceneId, chapterId: 'c' + chapterIndex, chapterIndex, chapterTitle: '', paragraphs, povId });

describe('character voices', () => {
  const chars = [ch('j', 'Jace Kensington', ['Jace']), ch('w', 'Winnie Hartley', ['Winnie']), ch('f', 'Finn Callahan', ['Finn'])];
  const scenes = [
    scene('s1', 0, [
      '“Turn that shit off,” Jace snapped.',
      '“Can you not right now? I am trying to hear my game,” Jace snapped.',
      '“Apparently you can’t sit still for five minutes without doing something annoying,” Jace said.',
      '“I’m sorry,” I whispered.',
    ], 'w'),
    scene('s2', 2, ['Finn shrugged. “Practice was rough. Coach ran us until dark.”', '“Practice again tomorrow,” Finn said.']),
  ];
  const v = characterVoices(scenes, chars, chars.flatMap((c) => [c.name, ...c.aliases]));

  it('counts lines and words for each speaker, most talkative first', () => {
    expect(v.map((x) => [x.name, x.lines])).toEqual([
      ['Jace Kensington', 3],
      ['Finn Callahan', 2],
      ['Winnie Hartley', 1],
    ]);
    const share = v.reduce((n, x) => n + x.share, 0);
    expect(share).toBeCloseTo(1);
    expect(v[0].tags[0]).toEqual(['snapped', 2]);
  });

  it('gives first-person lines to the point-of-view character', () => {
    expect(v.find((x) => x.referenceId === 'w')?.lines).toBe(1);
  });

  it('finds words a character uses more than others, and a sample line', () => {
    expect(v.find((x) => x.referenceId === 'f')?.signature).toContain('practice');
    expect(v.find((x) => x.referenceId === 'j')?.sample?.sceneId).toBe('s1');
    expect(v.find((x) => x.referenceId === 'f')?.chapters).toEqual([2]);
  });
});
