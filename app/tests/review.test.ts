import { reviewManuscript, sentencesOf, syllables, type SceneInput } from '../src/review/metrics';

const scene = (chapterId: string, text: string, sceneId = `s-${chapterId}`): SceneInput => ({ sceneId, chapterId, chapterTitle: `Chapter ${chapterId}`, text });

describe('whole-manuscript review', () => {
  it('splits sentences and counts syllables sensibly', () => {
    expect(sentencesOf('She ran. “Stop!” he said. It was 9 p.m. when it ended.')).toEqual(['She ran.', '“Stop!” he said.', 'It was 9 p.m. when it ended.']);
    expect(['cat', 'table', 'beautiful', 'running', 'the', 'education'].map(syllables)).toEqual([1, 2, 3, 2, 1, 4]);
  });

  it('finds most-used words and repeated phrases, ignoring names and glue words', () => {
    const text = Array.from({ length: 6 }, () => 'Winnie glanced at the harbour. The harbour lights flickered at the edge of the world.').join('\n\n');
    const r = reviewManuscript([scene('1', text)], ['Winnie Hartley']);
    expect(r.topWords.map((w) => w.word)).toEqual(expect.arrayContaining(['harbour', 'glanced', 'lights']));
    expect(r.topWords.find((w) => w.word === 'winnie')).toBeUndefined();
    expect(r.topWords.find((w) => w.word === 'harbour')).toMatchObject({ count: 12, byChapter: [12] });
    expect(r.topPhrases.map((p) => p.phrase)).toContain('at the edge of');
    expect(r.topPhrases[0].first).toMatchObject({ sceneId: 's-1', chapterTitle: 'Chapter 1' });
  });

  it('counts crutch words per chapter', () => {
    const r = reviewManuscript([scene('1', 'She just ran. He just stopped. It really began to rain.'), scene('2', 'Nothing at all.')]);
    expect(r.crutch.find((c) => c.word === 'just')).toMatchObject({ count: 2, byChapter: [2, 0] });
    expect(r.crutch.find((c) => c.word === 'began to')?.count).toBe(1);
  });

  it('flags sticky sentences and the longest sentences', () => {
    const r = reviewManuscript([scene('1', 'It was just that there was not really anything that he could have done about it at all. Storm clouds gathered over grey cliffs.')]);
    expect(r.sticky).toHaveLength(1);
    expect(r.sticky[0].snippet).toMatch(/^It was just that/);
    expect(r.sticky[0].share).toBeGreaterThanOrEqual(45);
  });

  it('measures readability, dialogue share and pacing per chapter', () => {
    const fast = 'She ran. He fell. Glass broke. Dogs barked.';
    const slow = Array.from({ length: 3 }, () => 'The long and winding history of the old harbour town, with its crooked lanes, salt-stained walls and centuries of quiet commerce between fishermen and merchants, stretched back further than anyone living could remember or would care to admit.').join('\n\n');
    const talk = '“Where were you?” Mara asked.\n\n“Out,” said Tom.';
    const r = reviewManuscript([scene('1', [fast, slow, talk].join('\n\n'))]);
    const ch = r.chapters[0];
    expect(ch.pacing.map((p) => p.kind)).toEqual(['fast', 'slow', 'dialogue']);
    expect(r.slowStretches).toHaveLength(1);
    expect(r.slowStretches[0].detail).toMatch(/3 long-sentence paragraphs/);
    expect(ch.dialogueShare).toBeGreaterThan(0);
    expect(ch.readingEase).toBeLessThan(100);
    expect(ch.sentenceSpread).toBeGreaterThan(5);
  });

  it('handles 100k words quickly', () => {
    const para = 'Winnie walked down to the harbour, where the boats rocked gently against the wooden pier and gulls cried overhead. “Late again,” said Tom.';
    const scenes = Array.from({ length: 40 }, (_, i) => scene(String(Math.floor(i / 2)), Array.from({ length: 110 }, () => para).join('\n\n'), `s${i}`));
    const t0 = performance.now();
    const r = reviewManuscript(scenes, ['Winnie Hartley', 'Tom Reyes']);
    const ms = performance.now() - t0;
    expect(r.words).toBeGreaterThan(100_000);
    expect(ms).toBeLessThan(3000);
  });
});
