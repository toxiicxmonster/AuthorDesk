// Large-manuscript checks. fake-indexeddb is much slower than a real browser, so these are upper bounds.
import { resetDbForTests, db } from '../src/storage/db';
import { createProject } from '../src/storage/repo';
import { newId, nowIso } from '../src/domain/ids';
import { plainTextToDoc, countWords } from '../src/domain/text';
import { searchProject } from '../src/storage/search';
import { referenceBacklinks } from '../src/storage/backlinks';
import { buildArchive, parseArchive } from '../src/importExport/archive';
import { runRules } from '../src/proofreading/rules';

const WORDS = 'the wind carried salt across the harbor while Elara counted the ships and wondered whether the old lighthouse keeper had lied about the storm'.split(' ');

function prose(n: number, seed: number) {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(WORDS[(i * 7 + seed) % WORDS.length]);
  const paras: string[] = [];
  for (let i = 0; i < out.length; i += 120) paras.push(out.slice(i, i + 120).join(' ') + '.');
  return paras.join('\n\n');
}

describe('large manuscript', () => {
  it('handles a 300k-word book with 2,000 references', async () => {
    resetDbForTests();
    const { project, book } = await createProject('Big');
    const now = nowIso();
    const base = { projectId: project.id, createdAt: now, updatedAt: now, archivedAt: null, rev: 1 };
    const chapters = Array.from({ length: 300 }, (_, i) => ({ ...base, id: newId(), bookId: book.id, partId: null, title: `Chapter ${i + 2}`, order: i + 1, summary: '', status: 'drafting' as const, pinned: false }));
    await db.chapters.bulkAdd(chapters);
    const scenes = chapters.map((c, i) => {
      const text = prose(1000, i);
      return { ...base, id: newId(), chapterId: c.id, title: 'Scene 1', order: 0, content: plainTextToDoc(text), plainText: text, wordCount: countWords(text), summary: '', status: 'drafting' as const, povCharacterId: null, locationId: null, timeMarker: '', notes: '', plotThreadIds: [], referenceIds: [] };
    });
    await db.scenes.bulkAdd(scenes);
    const refs = Array.from({ length: 2000 }, (_, i) => ({ ...base, id: newId(), type: 'character' as const, name: i === 0 ? 'Elara' : `Person ${i}`, aliases: [], summary: 'x', fields: { appearance: 'tall' }, tags: [], favorite: false, status: '', links: [], notes: '', image: '' }));
    await db.references.bulkAdd(refs);

    let t = performance.now();
    const results = await searchProject(project.id, 'lighthouse');
    const searchMs = performance.now() - t;
    expect(results.length).toBeGreaterThan(100);

    t = performance.now();
    const links = await referenceBacklinks(refs[0]);
    const backlinkMs = performance.now() - t;
    expect(links.length).toBe(300);

    t = performance.now();
    const { bytes } = await buildArchive(project.id);
    const parsed = await parseArchive(bytes);
    const archiveMs = performance.now() - t;
    expect(parsed.data.scenes.length).toBe(301);

    t = performance.now();
    runRules(prose(5000, 3), { dialect: 'en-US', disabledRules: new Set(), disabledCategories: new Set(), dictionary: new Set(), knownNames: refs.slice(0, 200).map((r) => r.name) });
    const rulesMs = performance.now() - t;

    console.log(`search ${searchMs.toFixed(0)}ms · backlinks ${backlinkMs.toFixed(0)}ms · archive round-trip ${archiveMs.toFixed(0)}ms (${(bytes.length / 1e6).toFixed(1)} MB) · rules on 5k words ${rulesMs.toFixed(0)}ms`);
    expect(searchMs).toBeLessThan(5000);
    expect(backlinkMs).toBeLessThan(5000);
    expect(rulesMs).toBeLessThan(1500);
  }, 120_000);
});

describe('whole-book checks on a full-length novel', () => {
  it('tense slips, character voices and pronouns stay quick on 100k words', async () => {
    const { findTenseSlips } = await import('../src/proofreading/tense');
    const { characterVoices } = await import('../src/review/voices');
    const { findInDoc } = await import('../src/domain/replace');
    const line = (i: number) =>
      i % 3 === 0 ? `“We should go before the storm,” Elara said, and she pulled her coat tighter.` : i % 3 === 1 ? `Tobias shrugged. “The boats will hold,” he muttered.` : 'I walked to the harbour and watched the lights of the town go out one by one.';
    const scenes = Array.from({ length: 70 }, (_, s) => ({
      sceneId: `s${s}`,
      chapterId: `c${s}`,
      chapterIndex: s,
      chapterTitle: `Chapter ${s + 1}`,
      paragraphs: Array.from({ length: 110 }, (_, p) => line(s + p)),
      povId: null,
    }));
    const words = scenes.reduce((n, s) => n + s.paragraphs.join(' ').split(/\s+/).length, 0);
    expect(words).toBeGreaterThan(95_000);
    const chars = [
      { id: 'e', name: 'Elara Quill', aliases: [], type: 'character', archivedAt: null },
      { id: 't', name: 'Tobias Wren', aliases: [], type: 'character', archivedAt: null },
    ] as never[];
    let t = performance.now();
    for (const s of scenes) findTenseSlips(s.paragraphs, ['Elara Quill', 'Tobias Wren']);
    const tenseMs = performance.now() - t;
    t = performance.now();
    const v = characterVoices(scenes, chars, ['Elara Quill', 'Tobias Wren']);
    const voicesMs = performance.now() - t;
    t = performance.now();
    for (const s of scenes) findInDoc({ type: 'doc', content: s.paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })) } as never, 'harbour', { caseSensitive: false, wholeWord: true });
    const replaceMs = performance.now() - t;
    expect(v.map((x) => x.name).sort()).toEqual(['Elara Quill', 'Tobias Wren']);
    // Generous ceilings for slow CI machines; in practice each is well under a second.
    expect(tenseMs).toBeLessThan(3000);
    expect(voicesMs).toBeLessThan(5000);
    expect(replaceMs).toBeLessThan(2000);
    console.info(`100k words: tense ${tenseMs.toFixed(0)} ms, voices ${voicesMs.toFixed(0)} ms, find ${replaceMs.toFixed(0)} ms`);
  }, 60_000);
});
