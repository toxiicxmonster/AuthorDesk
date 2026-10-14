import { resetDbForTests, db } from '../src/storage/db';
import { createBook, createProject, saveSceneContent } from '../src/storage/repo';
import { createReference } from '../src/domain/references';
import { plainTextToDoc } from '../src/domain/text';
import { combineIntoSeries, loadSeriesBooks, mergeEntry, seriesAppearances } from '../src/storage/series';
import { seriesScenes } from '../src/proofreading/continuityData';
import { findDeathIssues } from '../src/proofreading/continuity';
import type { ReferenceEntry } from '../src/domain/schema';

const firstScene = async (bookId: string) => {
  const ch = (await db.chapters.where('bookId').equals(bookId).toArray())[0];
  return (await db.scenes.where('chapterId').equals(ch.id).toArray())[0];
};

describe('series', () => {
  beforeEach(() => resetDbForTests());

  it('merges an entry into one of the same name without overwriting anything', () => {
    const base = { aliases: [], tags: [], links: [], summary: '', notes: '', status: '', image: '', fields: {} };
    const mine = { ...base, id: 'a', name: 'Winnie Hartley', fields: { appearance: 'Hair: auburn', age: '' }, aliases: ['Win'] } as unknown as ReferenceEntry;
    const theirs = { ...base, id: 'b', name: 'Winnie', fields: { appearance: 'Hair: black', age: '24' }, notes: 'Loves tea.' } as unknown as ReferenceEntry;
    const m = mergeEntry(mine, theirs);
    expect(m.fields).toEqual({ appearance: 'Hair: auburn', age: '24' });
    expect(m.aliases).toEqual(['Win', 'Winnie']);
    expect(m.notes).toBe('Loves tea.');
  });

  it('a second book makes the project a series', async () => {
    const { project } = await createProject('Saga');
    expect((await db.projects.get(project.id))!.kind).toBe('book');
    await createBook(project.id, 'Book Two');
    expect((await db.projects.get(project.id))!.kind).toBe('series');
  });

  it('brings another project’s books in, merging entries of the same name and repointing links to them', async () => {
    const { project: a, book: bookA } = await createProject('Book One');
    const winnieA = await createReference(a.id, 'character', 'Winnie Hartley', { fields: { appearance: 'Eyes: green' } });
    await saveSceneContent((await firstScene(bookA.id)).id, plainTextToDoc('Winnie Hartley opened the shop.'));

    const { project: b, book: bookB } = await createProject('Book Two');
    const winnieB = await createReference(b.id, 'character', 'Winnie Hartley', { fields: { appearance: 'Eyes: grey', age: '24' } });
    await createReference(b.id, 'character', 'Finn Callahan');
    const sceneB = await firstScene(bookB.id);
    await db.scenes.update(sceneB.id, { povCharacterId: winnieB.id });
    await saveSceneContent(sceneB.id, plainTextToDoc('Winnie Hartley met Finn at the rink.'));

    const r = await combineIntoSeries(a.id, b.id);
    expect(r).toEqual({ books: 1, merged: 1, added: 1 });
    expect((await db.projects.get(a.id))!.kind).toBe('series');
    expect((await db.projects.get(b.id))!.archivedAt).not.toBeNull();
    const books = (await db.books.where('projectId').equals(a.id).toArray()).sort((x, y) => x.order - y.order);
    expect(books.map((x) => x.title)).toEqual(['Book One', 'Book Two']);
    const refs = (await db.references.where('projectId').equals(a.id).toArray()).filter((x) => !x.archivedAt);
    expect(refs.map((x) => x.name).sort()).toEqual(['Finn Callahan', 'Winnie Hartley']);
    const winnie = refs.find((x) => x.name === 'Winnie Hartley')!;
    expect(winnie.id).toBe(winnieA.id);
    expect(winnie.fields).toEqual({ appearance: 'Eyes: green', age: '24' });
    // The other book's scene now points at the one shared entry.
    const moved = (await db.scenes.where('projectId').equals(a.id).toArray()).find((s) => s.plainText.includes('rink'))!;
    expect(moved.povCharacterId).toBe(winnieA.id);

    // Where each entry appears, book by book.
    const series = await loadSeriesBooks(a.id);
    const apps = seriesAppearances(series, refs);
    expect(apps.find((x) => x.referenceId === winnie.id)).toMatchObject({ perBook: [1, 1], first: { book: 0 } });
    expect(apps.find((x) => x.referenceId !== winnie.id)).toMatchObject({ perBook: [0, 1], first: { book: 1 } });

    // Continuity reads every book, titled by book.
    const scenes = (await seriesScenes(a.id))!;
    expect(scenes.map((s) => s.bookIndex)).toEqual([0, 1]);
    expect(scenes[1].chapterTitle).toBe('Book Two · Chapter 1');
  });

  it('reads “deceased, Book 1 Ch. 1” across books', () => {
    const scenes = [
      { sceneId: 'a', bookIndex: 0, chapterIndex: 0, chapterTitle: 'B1 · Ch 1', paragraphs: ['“Hello,” said Tom.'] },
      { sceneId: 'b', bookIndex: 0, chapterIndex: 2, chapterTitle: 'B1 · Ch 3', paragraphs: ['“Hello,” said Tom.'] },
      { sceneId: 'c', bookIndex: 1, chapterIndex: 0, chapterTitle: 'B2 · Ch 1', paragraphs: ['“Hello,” said Tom.'] },
    ];
    const tom = { id: 't', name: 'Tom', aliases: [], appearance: '', status: 'deceased, Book 1 Ch. 1' };
    expect(findDeathIssues(scenes, [tom], ['Tom']).map((d) => d.sceneId)).toEqual(['b', 'c']);
    // Book 2's death doesn't flag book 1.
    expect(findDeathIssues(scenes, [{ ...tom, status: 'killed in Book 2, chapter 1' }], ['Tom'])).toEqual([]);
  });
});
