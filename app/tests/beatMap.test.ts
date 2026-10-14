import { BUILTIN_TEMPLATES, beatPosition } from '../src/domain/boardTemplates';
import { beatPositions, sceneAt, scenePositions, suggestByPosition } from '../src/domain/beatMap';
import { beatMapMessages, inStoryOrder, mapBeatsWithAi, readBeatMatches } from '../src/ai/beatMap';

const scenes = [
  { sceneId: 'a', chapterId: 'c1', words: 1000 },
  { sceneId: 'b', chapterId: 'c1', words: 1000 },
  { sceneId: 'c', chapterId: 'c2', words: 2000 },
];

describe('plot templates', () => {
  it('every built-in beat says what it is and where it usually falls', () => {
    for (const t of BUILTIN_TEMPLATES.filter((t) => t.id !== 'blank')) {
      const cards = t.lanes.flatMap((l) => l.cards);
      expect(cards.every((c) => c.summary && c.at !== undefined && c.at >= 0 && c.at <= 1)).toBe(true);
      const ats = cards.map((c) => c.at!);
      expect(ats).toEqual([...ats].sort((x, y) => x - y)); // in story order
    }
    expect(BUILTIN_TEMPLATES.map((t) => t.id)).toContain('seven-point');
    expect(beatPosition('Midpoint')).toBe(0.5);
    expect(beatPosition('My own beat')).toBeNull();
  });
});

describe('mapping a draft to the beats', () => {
  it('finds the scene at a point in the book by word count', () => {
    expect(sceneAt(scenes, 0.1)!.sceneId).toBe('a');
    expect(sceneAt(scenes, 0.4)!.sceneId).toBe('b');
    expect(sceneAt(scenes, 0.9)!.sceneId).toBe('c');
    expect(sceneAt([], 0.5)).toBeNull();
    expect(scenePositions(scenes)).toEqual(new Map([['a', 0], ['b', 0.25], ['c', 0.5]]));
  });

  it('uses the template’s position for known beats and the beat order for the author’s own', () => {
    const beats = [
      { id: '1', title: 'Catalyst' },
      { id: '2', title: 'My twist' },
      { id: '3', title: 'Final image' },
    ];
    expect(beatPositions(beats).get('1')).toBe(0.1);
    expect(beatPositions(beats).get('2')).toBe(0.5);
    expect(suggestByPosition(beats, scenes).map((s) => s.sceneId)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the AI’s matches in story order, and no more than three beats on one scene', () => {
    const beats = ['1', '2', '3', '4', '5', '6'].map((id) => ({ id }));
    const sc = ['a', 'b', 'c'].map((sceneId) => ({ sceneId }));
    const m = (beatId: string, sceneId: string) => ({ beatId, sceneId, why: '' });
    // Beat 4 goes back to scene a after beat 3 reached c: dropped.
    expect(inStoryOrder([m('1', 'a'), m('2', 'b'), m('3', 'c'), m('4', 'a'), m('5', 'c')], beats, sc).map((x) => x.beatId)).toEqual(['1', '2', '3', '5']);
    expect(inStoryOrder(['1', '2', '3', '4', '5'].map((b) => m(b, 'c')), beats, sc)).toHaveLength(3);
  });

  it('asks the AI Editor what each scene does, and keeps only real beat and scene numbers', async () => {
    const beats = [
      { id: 'x', title: 'Catalyst', summary: 'The life-changing event.', at: 0.1 },
      { id: 'y', title: 'Midpoint', summary: 'A reversal.', at: 0.5 },
    ];
    const sc = [
      { sceneId: 'a', label: 'Ch 1: Morning', gist: 'Winnie gets the call that her grandmother died.', at: 0 },
      { sceneId: 'b', label: 'Ch 2: Hospital', gist: 'She drives to the hospital.', at: 0.5 },
    ];
    expect(beatMapMessages(beats, sc)[1].content).toMatch(/1\. \[0%\] Ch 1: Morning: Winnie gets the call/);
    expect(readBeatMatches('{"matches":[{"beat":1,"scene":1,"why":"The call changes everything."},{"beat":2,"scene":9,"why":"?"},{"beat":7,"scene":1,"why":"?"}]}', beats, sc)).toEqual([
      { beatId: 'x', sceneId: 'a', why: 'The call changes everything.' },
    ]);
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"matches":[{"beat":2,"scene":2,"why":"Her world turns."}]}' } }] }))) as unknown as typeof fetch;
    expect(await mapBeatsWithAi(beats, sc, { fetchImpl })).toEqual([{ beatId: 'y', sceneId: 'b', why: 'Her world turns.' }]);
  });
});
