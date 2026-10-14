import { resetDbForTests, db } from '../src/storage/db';
import { createProject, createRecord, saveSceneContent, updateRecord } from '../src/storage/repo';
import { plainTextToDoc } from '../src/domain/text';
import { collectPassItems, locateItem, passProgress, passReport, type PassScene } from '../src/review/editPass';
import { deleteEditPass, startEditPass } from '../src/storage/revisions';
import type { Revision } from '../src/domain/schema';

const ctx = { dialect: 'en-US' as const, disabledRules: new Set<string>(), disabledCategories: new Set<string>(), dictionary: new Set<string>(), knownNames: ['Winnie Hartley'] };

describe('edit pass items', () => {
  const scenes: PassScene[] = [
    { sceneId: 's1', chapterId: 'c1', chapterTitle: 'One', paragraphs: ['She was very tired after the long day.', 'She walked to the gate. The wind rose. Then she walked home.'] },
    { sceneId: 's2', chapterId: 'c2', chapterTitle: 'Two', paragraphs: ['Winnie Hartley ran quickly to the car.'] },
  ];

  it('collects fixes and echoes in reading order, with the sentence around each', async () => {
    const items = await collectPassItems(scenes, ctx, { aiInstalled: false });
    const summary = items.map((i) => `${i.sceneId}:${i.ruleId}:${i.quote}`);
    expect(summary).toContain('s1:stronger-word:very tired');
    expect(summary).toContain('s1:echo-word:walked');
    expect(summary).toContain('s2:stronger-word:ran quickly');
    expect(items.map((i) => i.order)).toEqual(items.map((_, i) => i));
    expect(items.findIndex((i) => i.sceneId === 's2')).toBeGreaterThan(items.findIndex((i) => i.quote === 'walked'));
    expect(items.find((i) => i.quote === 'very tired')!.context).toBe('She was very tired after the long day.');
  });

  it('leaves out what the author already ignored, and hard sentences without the AI Editor', async () => {
    const items = await collectPassItems(scenes, ctx, { aiInstalled: false, skip: (rule) => rule === 'echo-word' });
    expect(items.some((i) => i.ruleId === 'echo-word' || i.kind === 'hard')).toBe(false);
  });

  it('finds an item again after edits elsewhere, and knows when its words are gone', () => {
    const it = { quote: 'very tired', context: 'She was very tired after the long day.' };
    const text = 'A new opening line. She was very tired after the long day.';
    expect(locateItem(text, it)).toEqual({ start: 28, end: 38 });
    expect(locateItem('She was very tired, finally.', it)).toEqual({ start: 8, end: 18 });
    expect(locateItem('She was exhausted after the long day.', it)).toBeNull();
    expect(locateItem('very tired, very tired', it)).toBeNull(); // ambiguous: can't tell which
  });

  it('counts progress (rewritten items count as done) and writes a report by chapter', () => {
    const items = [
      { status: 'done' },
      { status: 'open' },
      { status: 'later' },
      { status: 'open' },
    ] as Revision[];
    expect(passProgress(items, new Set(['d']), ['a', 'b', 'c', 'd'])).toEqual({ total: 4, done: 2, open: 1, later: 1 });
    const rev = (o: Partial<Revision>) => ({ quote: 'x', message: 'm', replacements: [], note: '', status: 'open', kind: 'grammar', chapterId: 'c1', order: 0, ...o }) as Revision;
    const md = passReport('Edit pass: One', [rev({ quote: 'very tired', replacements: ['exhausted'], status: 'done', kind: 'clarity' }), rev({ order: 1, chapterId: 'c2', note: 'check with Mads', status: 'later' })], new Map([['c1', 'One'], ['c2', 'Two']]));
    expect(md).toMatch(/^# Edit pass: One/);
    expect(md).toMatch(/## One[\s\S]*\[x\] \*\*Clarity & readability\*\*: “very tired”.*Suggested: “exhausted”/);
    expect(md).toMatch(/## Two[\s\S]*\(later\)[\s\S]*Note: check with Mads/);
  });
});

describe('starting an edit pass', () => {
  beforeEach(() => resetDbForTests());

  it('saves the items of a chapter as a checklist, and deletes them again', async () => {
    const { project, book } = await createProject('Pass');
    const chapter = (await db.chapters.where('bookId').equals(book.id).toArray())[0];
    const scene = (await db.scenes.where('chapterId').equals(chapter.id).toArray())[0];
    await saveSceneContent(scene.id, plainTextToDoc('She was very tired after the long day.\n\nHe ran quickly home.'));
    const other = await createRecord('chapters', project.id, { bookId: book.id, partId: null, title: 'Two', order: 1, summary: '', status: 'drafting', pinned: false });
    void other;
    const { passId, count } = await startEditPass(project.id, book.id, chapter.id, 'Edit pass: Chapter 1');
    expect(count).toBeGreaterThanOrEqual(2);
    const saved = await db.revisions.where('passId').equals(passId).toArray();
    expect(saved).toHaveLength(count);
    expect(saved.every((r) => r.status === 'open' && r.passName === 'Edit pass: Chapter 1' && r.sceneId === scene.id)).toBe(true);
    await updateRecord('revisions', saved[0].id, { status: 'done' });
    await deleteEditPass(passId);
    expect(await db.revisions.count()).toBe(0);
  });
});
