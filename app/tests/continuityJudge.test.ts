import { describe, expect, it } from 'vitest';
import { changeMessages, judgeChange, parseChangeView } from '../src/ai/continuityJudge';
import type { Contradiction, ContinuityScene } from '../src/proofreading/continuity';

const scenes: ContinuityScene[] = [
  { sceneId: 'a', chapterId: 'c1', chapterIndex: 0, chapterTitle: 'One', paragraphs: ['Morning came.', 'Winnie pushed her red hair out of her eyes.'] },
  { sceneId: 'b', chapterId: 'c2', chapterIndex: 1, chapterTitle: 'Two', paragraphs: ['She sat in the salon for three hours while they dyed her hair.', 'The weather was cold.'] },
  { sceneId: 'c', chapterId: 'c3', chapterIndex: 2, chapterTitle: 'Three', paragraphs: ['Winnie tucked her black hair behind an ear.'] },
];
const fact = (sceneId: string, block: number, value: string, chapterTitle: string) =>
  ({ sceneId, block, value, chapterTitle, chapterIndex: 0, start: 0, end: 1, original: `${value} hair`, characterId: 'w', characterName: 'Winnie Hartley', attribute: 'hair', label: 'Hair' }) as unknown as Contradiction['first'];
const c: Contradiction = { key: 'k', characterId: 'w', characterName: 'Winnie Hartley', label: 'Hair', first: fact('a', 1, 'red', 'One'), other: fact('c', 0, 'black', 'Three'), note: '' };

describe('contradiction or deliberate change', () => {
  it('gives the model both passages and what the story says in between', () => {
    const user = changeMessages(c, scenes)[1].content;
    expect(user).toContain('red hair out of her eyes');
    expect(user).toContain('dyed her hair');
    expect(user).toContain('black hair behind');
    expect(user).not.toContain('weather');
  });

  it('reads the verdict, falling back to unclear', () => {
    expect(parseChangeView('{"verdict":"deliberate","reason":"Chapter Two has her hair dyed."}')).toEqual({ verdict: 'deliberate', reason: 'Chapter Two has her hair dyed.' });
    expect(parseChangeView('{"verdict":"maybe","reason":"x"}').verdict).toBe('unclear');
    expect(parseChangeView('no idea').verdict).toBe('unclear');
  });

  it('asks once per contradiction', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"verdict":"mistake","reason":"Nothing explains it."}' } }] }));
    }) as unknown as typeof fetch;
    expect(await judgeChange(c, scenes, { fetchImpl })).toEqual({ verdict: 'mistake', reason: 'Nothing explains it.' });
    await judgeChange(c, scenes, { fetchImpl });
    expect(calls).toBe(1);
  });
});
