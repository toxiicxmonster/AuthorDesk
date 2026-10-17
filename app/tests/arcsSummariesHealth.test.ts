import { arcChapters, arcWarnings, characterArcs } from '../src/review/arcs';
import { plainSummary, STALE_BELOW, chapterSummaryMessages, sceneSummaryMessages, summarizeScene, summaryBasis, summaryFreshness } from '../src/ai/summaries';
import { checkAiEditor, checkGrammarEngine, repairAddon } from '../src/setup/health';
import type { ReferenceEntry } from '../src/domain/schema';

const character = (id: string, name: string, aliases: string[] = []) =>
  ({ id, name, aliases, type: 'character', archivedAt: null, fields: {}, links: [], tags: [], summary: '', notes: '', status: '', image: '', favorite: false }) as unknown as ReferenceEntry;

describe('character arcs', () => {
  const tom = character('t', 'Tom Reyes');
  const winnie = character('w', 'Winnie Hartley');
  const scenes = Array.from({ length: 9 }, (_, i) => ({
    sceneId: `s${i}`,
    chapterIndex: i,
    chapterTitle: `Chapter ${i + 1}`,
    paragraphs: i === 0 ? ['Winnie met Tom at the gate. “Hello,” said Tom.'] : i === 1 ? ['Tom left early.'] : ['Winnie walked home alone.'],
  }));
  const chapters = arcChapters(scenes);
  const [tArc, wArc] = characterArcs(chapters, [tom, winnie], ['Tom Reyes', 'Winnie Hartley']);

  it('counts mentions and lines per chapter, with first and last seen', () => {
    expect(tArc.perChapter[0]).toMatchObject({ mentions: 2, lines: 1, sceneId: 's0' });
    expect(tArc.first).toBe(0);
    expect(tArc.last).toBe(1);
    expect(wArc.perChapter.filter((p) => p.mentions > 0)).toHaveLength(8); // every chapter but the second
  });

  it('finds stretches of 5+ chapters without someone, and words them for the review', () => {
    expect(tArc.gaps).toEqual([{ from: 2, to: 8, toEnd: true, missed: 7, after: 1 }]);
    expect(wArc.gaps).toEqual([]);
    expect(arcWarnings([tArc, wArc], chapters)).toEqual([{ referenceId: 't', sceneId: 's1', message: 'Tom Reyes hasn’t appeared since Chapter 2 (7 chapters).' }]);
  });

  it('doesn’t count chapters with no story text yet (only plan bullets, or nothing)', () => {
    const planned = scenes.map((sc, i) => (i >= 3 ? { ...sc, paragraphs: i % 2 ? [] : ['- Winnie finds the key', '- Tom comes back'] } : sc));
    const ch = arcChapters(planned);
    const [t] = characterArcs(ch, [tom, winnie], ['Tom Reyes', 'Winnie Hartley']);
    expect(t.gaps).toEqual([]); // only Chapter 3 is written after Tom's last chapter
    expect(arcWarnings([t], ch)).toEqual([]);
    // A written chapter between two plan-only ones still counts, and the gap is measured in written chapters.
    const more = arcChapters(scenes.map((sc, i) => (i === 4 ? { ...sc, paragraphs: [] } : sc)));
    const [t2] = characterArcs(more, [tom], ['Tom Reyes']);
    expect(t2.gaps).toEqual([{ from: 2, to: 8, toEnd: true, missed: 6, after: 1 }]);
    expect(arcWarnings([t2], more)[0].message).toBe('Tom Reyes hasn’t appeared since Chapter 2 (6 chapters).');
  });

  it('groups a series’ scenes into chapters per book', () => {
    const ch = arcChapters([
      { sceneId: 'a', bookIndex: 0, chapterIndex: 0, chapterTitle: 'B1 · One', paragraphs: [] },
      { sceneId: 'b', bookIndex: 0, chapterIndex: 0, chapterTitle: 'B1 · One', paragraphs: [] },
      { sceneId: 'c', bookIndex: 1, chapterIndex: 0, chapterTitle: 'B2 · One', paragraphs: [] },
    ]);
    expect(ch.map((c) => [c.key, c.scenes.length])).toEqual([
      ['0:0', 2],
      ['1:0', 1],
    ]);
  });
});

describe('AI summaries', () => {
  const text = 'Winnie opens the shop. The bell rings. Finn walks in.\n\nShe pretends not to see him.';

  it('knows when a scene has changed a lot since its summary', () => {
    const basis = summaryBasis(text);
    expect(summaryFreshness(text, basis)).toBe(1);
    expect(summaryFreshness(text + ' He waits.', basis)).toBeGreaterThanOrEqual(STALE_BELOW);
    expect(summaryFreshness('Something else entirely happens. Nobody comes. The end.', basis)).toBeLessThan(STALE_BELOW);
    expect(summaryFreshness(text, undefined)).toBe(1); // a summary written by hand isn't judged
  });

  it('asks for a short factual synopsis, and builds the chapter’s from its scenes', async () => {
    expect(sceneSummaryMessages(text)[0].content).toMatch(/2 or 3 sentences, present tense/);
    expect(chapterSummaryMessages(['Winnie opens the shop.', 'Finn returns.'])[1].content).toBe('Scene 1: Winnie opens the shop.\nScene 2: Finn returns.');
    const answer = JSON.stringify({ summary: '**Scene Summary:**\n- Winnie opens the shop.\n- She ignores **Finn**.' });
    const fetchImpl = (async () => new Response(JSON.stringify({ choices: [{ message: { content: answer } }] }))) as unknown as typeof fetch;
    expect(await summarizeScene(text, { fetchImpl })).toBe('Winnie opens the shop. She ignores Finn.');
    expect(plainSummary('Winnie opens the shop.')).toBe('Winnie opens the shop.');
  });
});

describe('add-on health check', () => {
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });

  it('has the grammar engine check a sentence with a known mistake', async () => {
    const ok = (async (url: string) => (url === '/grammar/status' ? json({ installed: true, ready: true }) : json({ matches: [{ message: 'go → went' }] }))) as unknown as typeof fetch;
    expect(await checkGrammarEngine(ok)).toMatchObject({ ok: true, message: expect.stringMatching(/^Working: caught a test mistake/) });
    const blind = (async (url: string) => (url === '/grammar/status' ? json({ installed: true }) : json({ matches: [] }))) as unknown as typeof fetch;
    expect(await checkGrammarEngine(blind)).toMatchObject({ ok: false, message: expect.stringMatching(/Repair/) });
    const missing = (async () => json({ installed: false })) as unknown as typeof fetch;
    expect((await checkGrammarEngine(missing)).message).toMatch(/Not installed/);
  });

  it('has the AI Editor answer a question with a checkable answer', async () => {
    const ai = (async (url: string) => (url === '/ai/status' ? json({ installed: true, ready: true, model: 'Test 7B' }) : json({ choices: [{ message: { content: '5' } }] }))) as unknown as typeof fetch;
    expect(await checkAiEditor(ai)).toMatchObject({ ok: true, message: expect.stringMatching(/^Working: Test 7B answered/) });
  });

  it('asks the launcher to repair one add-on', async () => {
    let called = '';
    const f = (async (url: string, init: RequestInit) => {
      called = `${init.method} ${url}`;
      return json({ freeGb: 100, parts: {} });
    }) as unknown as typeof fetch;
    expect(await repairAddon('ai', f)).toEqual({ freeGb: 100, parts: {} });
    expect(called).toBe('POST /setup/install?parts=ai&repair=1');
  });
});
