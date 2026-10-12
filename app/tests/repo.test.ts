import { resetDbForTests, db } from '../src/storage/db';
import {
  createProject,
  createChapter,
  createScene,
  reorder,
  moveScene,
  saveSceneContent,
  splitScene,
  mergeScenes,
  archiveRecord,
  createCard,
  convertCardToScene,
  convertCardToChapter,
  moveCard,
  restoreSnapshot,
  createSnapshot,
  deleteProjectCascade,
} from '../src/storage/repo';
import { createReference } from '../src/domain/references';
import { referenceBacklinks, unlinkReferenceEverywhere } from '../src/storage/backlinks';
import { plainTextToDoc } from '../src/domain/text';
import { searchProject } from '../src/storage/search';

beforeEach(() => {
  resetDbForTests();
});

async function chaptersOf(bookId: string) {
  return (await db.chapters.where('bookId').equals(bookId).toArray()).filter((c) => !c.archivedAt).sort((a, b) => a.order - b.order);
}
async function scenesOf(chapterId: string) {
  return (await db.scenes.where('chapterId').equals(chapterId).toArray()).filter((s) => !s.archivedAt).sort((a, b) => a.order - b.order);
}

describe('projects and manuscript', () => {
  it('creates a project with a book, a first chapter, a scene and board lanes', async () => {
    const { project, book } = await createProject('My Novel');
    expect(project.name).toBe('My Novel');
    const chapters = await chaptersOf(book.id);
    expect(chapters).toHaveLength(1);
    expect(await scenesOf(chapters[0].id)).toHaveLength(1);
    expect(await db.boardLanes.where('bookId').equals(book.id).count()).toBe(3);
  });

  it('saves prose, derives counts and persists across reloads', async () => {
    const { book } = await createProject('P');
    const [ch] = await chaptersOf(book.id);
    const [sc] = await scenesOf(ch.id);
    await saveSceneContent(sc.id, plainTextToDoc('One two three.\n\nFour five.'));
    const again = await db.scenes.get(sc.id);
    expect(again?.wordCount).toBe(5);
    expect(again?.plainText).toContain('Four five.');
    expect(again?.rev).toBeGreaterThan(sc.rev);
  });

  it('reorders chapters while preserving ids', async () => {
    const { project, book } = await createProject('P');
    await createChapter(project.id, book.id, 'Two');
    await createChapter(project.id, book.id, 'Three');
    const before = await chaptersOf(book.id);
    await reorder('chapters', [before[2].id, before[0].id, before[1].id]);
    const after = await chaptersOf(book.id);
    expect(after.map((c) => c.title)).toEqual(['Three', 'Chapter 1', 'Two']);
    expect(new Set(after.map((c) => c.id))).toEqual(new Set(before.map((c) => c.id)));
  });

  it('inserts a chapter at a position', async () => {
    const { project, book } = await createProject('P');
    await createChapter(project.id, book.id, 'Last');
    await createChapter(project.id, book.id, 'Middle', { atIndex: 1 });
    expect((await chaptersOf(book.id)).map((c) => c.title)).toEqual(['Chapter 1', 'Middle', 'Last']);
  });

  it('moves a scene between chapters keeping its id and links', async () => {
    const { project, book } = await createProject('P');
    const ch2 = await createChapter(project.id, book.id, 'Two');
    const [ch1] = await chaptersOf(book.id);
    const extra = await createScene(project.id, ch1.id, 'Mover', plainTextToDoc('Text'));
    const ref = await createReference(project.id, 'character', 'Elara');
    await saveSceneContent(extra.id, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Elara', marks: [{ type: 'refLink', attrs: { refId: ref.id } }] }] }],
    });
    await moveScene(extra.id, ch2.id, 0);
    const moved = await db.scenes.get(extra.id);
    expect(moved?.chapterId).toBe(ch2.id);
    expect((await scenesOf(ch2.id))[0].id).toBe(extra.id);
    expect((await scenesOf(ch1.id)).map((s) => s.order)).toEqual([0]);
    const links = await referenceBacklinks(ref);
    expect(links.some((l) => l.id === extra.id && l.how === 'linked')).toBe(true);
  });

  it('splits and merges scenes without losing text', async () => {
    const { book } = await createProject('P');
    const [ch] = await chaptersOf(book.id);
    const [sc] = await scenesOf(ch.id);
    await saveSceneContent(sc.id, plainTextToDoc('A.\n\nB.\n\nC.'));
    const second = await splitScene(sc.id, 2, 'Part two');
    expect((await db.scenes.get(sc.id))?.plainText).toBe('A.\n\nB.');
    expect(second.plainText).toBe('C.');
    expect((await scenesOf(ch.id)).map((s) => s.id)).toEqual([sc.id, second.id]);
    await mergeScenes(sc.id, second.id);
    expect((await db.scenes.get(sc.id))?.plainText).toBe('A.\n\nB.\n\n* * *\n\nC.');
    expect((await db.scenes.get(second.id))?.archivedAt).not.toBeNull();
    expect(await db.snapshots.where('sceneId').equals(sc.id).count()).toBeGreaterThan(0);
  });

  it('restores a snapshot and keeps the current text as a snapshot', async () => {
    const { book } = await createProject('P');
    const [ch] = await chaptersOf(book.id);
    const [sc] = await scenesOf(ch.id);
    await saveSceneContent(sc.id, plainTextToDoc('Original.'));
    const snap = await createSnapshot((await db.scenes.get(sc.id))!, 'manual');
    await saveSceneContent(sc.id, plainTextToDoc('Rewritten.'));
    await restoreSnapshot(snap.id);
    expect((await db.scenes.get(sc.id))?.plainText).toBe('Original.');
    const snaps = await db.snapshots.where('sceneId').equals(sc.id).toArray();
    expect(snaps.some((s) => s.plainText === 'Rewritten.' && s.reason === 'before restore')).toBe(true);
  });

  it('archives instead of deleting', async () => {
    const { book } = await createProject('P');
    const [ch] = await chaptersOf(book.id);
    await archiveRecord('chapters', ch.id);
    expect(await chaptersOf(book.id)).toHaveLength(0);
    expect(await db.chapters.get(ch.id)).toBeDefined();
  });

  it('deletes a whole project and nothing else', async () => {
    const a = await createProject('A');
    const b = await createProject('B');
    await deleteProjectCascade(a.project.id);
    expect(await db.projects.get(a.project.id)).toBeUndefined();
    expect(await db.scenes.where('projectId').equals(a.project.id).count()).toBe(0);
    expect(await db.scenes.where('projectId').equals(b.project.id).count()).toBe(1);
  });

  it('keeps the change log bounded to one entry per record', async () => {
    const { book } = await createProject('P');
    const [ch] = await chaptersOf(book.id);
    const [sc] = await scenesOf(ch.id);
    for (let i = 0; i < 5; i++) await saveSceneContent(sc.id, plainTextToDoc(`v${i}`));
    expect(await db.changes.where('recordId').equals(sc.id).count()).toBe(1);
  });
});

describe('board', () => {
  it('moves cards between lanes and converts a card into a scene with its notes', async () => {
    const { project, book } = await createProject('P');
    const lanes = (await db.boardLanes.where('bookId').equals(book.id).toArray()).sort((a, b) => a.order - b.order);
    const card = await createCard(project.id, book.id, lanes[0].id, { title: 'Ambush', summary: 'They are ambushed', notes: 'rain' });
    await moveCard(card.id, lanes[1].id, 0);
    expect((await db.boardCards.get(card.id))?.laneId).toBe(lanes[1].id);
    const [ch] = await chaptersOf(book.id);
    const scene = await convertCardToScene(card.id, ch.id);
    expect(scene.summary).toBe('They are ambushed');
    expect(scene.notes).toBe('rain');
    expect((await db.boardCards.get(card.id))?.sceneId).toBe(scene.id);
  });

  it('converts a card into a new chapter', async () => {
    const { project, book } = await createProject('P');
    const lanes = await db.boardLanes.where('bookId').equals(book.id).toArray();
    const card = await createCard(project.id, book.id, lanes[0].id, { title: 'The Siege', summary: 'Walls fall' });
    const { chapter } = await convertCardToChapter(card.id);
    expect(chapter.title).toBe('The Siege');
    expect((await db.chapters.get(chapter.id))?.summary).toBe('Walls fall');
    expect(await scenesOf(chapter.id)).toHaveLength(1);
  });
});

describe('references', () => {
  it('finds mentions and removes links on permanent delete without touching prose', async () => {
    const { project, book } = await createProject('P');
    const [ch] = await chaptersOf(book.id);
    const [sc] = await scenesOf(ch.id);
    const ref = await createReference(project.id, 'character', 'Elara', { aliases: ['El'] });
    await saveSceneContent(sc.id, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Elara', marks: [{ type: 'refLink', attrs: { refId: ref.id } }] }, { type: 'text', text: ' and El.' }] }],
    });
    expect((await referenceBacklinks(ref)).length).toBe(1);
    await unlinkReferenceEverywhere(ref.id, project.id);
    const after = await db.scenes.get(sc.id);
    expect(after?.referenceIds).toEqual([]);
    expect(after?.plainText).toBe('Elara and El.');
    expect((await referenceBacklinks(ref))[0].how).toBe('mentioned');
  });
});

describe('search', () => {
  it('searches manuscript text, references and notes', async () => {
    const { project, book } = await createProject('P');
    const [ch] = await chaptersOf(book.id);
    const [sc] = await scenesOf(ch.id);
    await saveSceneContent(sc.id, plainTextToDoc('The lighthouse keeper waited.'));
    await createReference(project.id, 'location', 'Lighthouse Point');
    const r = await searchProject(project.id, 'lighthouse');
    expect(r.map((x) => x.kind).sort()).toEqual(['reference', 'scene']);
    expect(r.find((x) => x.kind === 'scene')?.target).toEqual({ view: 'write', itemId: sc.id });
    expect(await searchProject(project.id, 'lighthouse', { kinds: ['reference'] })).toHaveLength(1);
  });
});
