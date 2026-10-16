import { describe, expect, it } from 'vitest';
import { chapterNotesMessages, explainChapter, groupIssues, parseNotes, standOuts, topGroups } from '../src/ai/chapterNotes';
import type { PassItemDraft } from '../src/review/editPass';

const item = (kind: string, ruleId: string, quote: string, context: string): PassItemDraft => ({ sceneId: 's', chapterId: 'c', order: 0, quote, context, kind, ruleId, message: '', replacements: [] });

describe('chapter notes', () => {
  it('groups findings by kind, biggest first, with a few examples', () => {
    const g = groupIssues([
      item('echo', 'echo-word', 'hand', 'I rub the back of my hand.'),
      item('grammar', 'tense-shift', 'hold', 'I hold back tears.'),
      item('echo', 'echo-word', 'phone', 'I lowered my phone.'),
      item('echo', 'echo-word', 'phone', 'I lowered my phone.'),
    ]);
    expect(g.map((x) => [x.label, x.count])).toEqual([
      ['Echo words', 3],
      ['Tense slips', 1],
    ]);
    expect(g[0].examples).toHaveLength(2);
  });

  it('notes only where the chapter clearly differs from the book', () => {
    const base = { words: 1000, sentences: 50, avgSentence: 12, sentenceSpread: 6, readingEase: 70, grade: 6, dialogueShare: 0.3, per1k: { adverbs: 4, crutch: 3, passive: 1, filler: 2, tags: 3, echoes: 2 } };
    expect(standOuts({ ...base, chapterId: 'c', title: 'One', pacing: [] }, base)).toEqual([]);
    const loud = standOuts({ ...base, chapterId: 'c', title: 'One', pacing: [], per1k: { ...base.per1k, adverbs: 9 }, dialogueShare: 0.05 }, base);
    expect(loud.join(' ')).toContain('adverbs: 9.0 per 1,000');
    expect(loud.join(' ')).toContain('little dialogue');
  });

  it('puts real errors first and leaves out rare style notes', () => {
    const g = groupIssues([
      ...['a', 'b', 'c', 'd'].map((w) => item('echo', 'echo-word', w, `${w}.`)),
      item('style', 'adverb', 'neatly', 'neatly.'),
      item('grammar', 'tense-shift', 'hold', 'I hold back tears.'),
    ]);
    expect(topGroups(g).map((x) => x.label)).toEqual(['Tense slips', 'Echo words']);
  });

  it('asks for one note per pattern, and the counts come from the checks', async () => {
    const top = topGroups(groupIssues([item('grammar', 'tense-shift', 'hold', 'I hold back tears.')]));
    const m = chapterNotesMessages('The things we leave behind', top, []);
    expect(m[1].content).toContain('Pattern 1: Tense slips.');
    expect(m[1].content).toContain('“hold” in: I hold back tears.');
    expect(m[0].content).toContain('exactly 1 strings');
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"notes":["**Tense** drifts."]}' } }] }))) as unknown as typeof fetch;
    const notes = await explainChapter('One', [item('grammar', 'tense-shift', 'hold', 'I hold back tears.')], undefined, {} as never, { fetchImpl });
    expect(notes).toEqual([{ heading: 'Tense slips (1)', text: 'Tense drifts.', example: 'I hold back tears.' }]);
    expect(parseNotes('1. One\n2. Two')).toEqual(['One', 'Two']);
  });
});
