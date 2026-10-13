import { resetDbForTests, db } from '../src/storage/db';
import { createProject, createBook, updateRecord, saveSceneContent } from '../src/storage/repo';
import { adoptLegacyBookPages, deleteBookPage, newBookPage, restoreBookPage, saveBookPage } from '../src/storage/bookPages';
import { pageChoices, projectPages, resolveExtraPages, defaultPage } from '../src/domain/bookPages';
import { exportMarkdownZip, exportText } from '../src/importExport/exporters';
import { buildPublishModel, DEFAULT_PUBLISH_OPTIONS } from '../src/importExport/publish';
import { plainTextToDoc } from '../src/domain/text';
import { unzipSync, strFromU8 } from 'fflate';

beforeEach(() => {
  resetDbForTests();
});

async function all() {
  return { projects: await db.projects.toArray(), books: await db.books.toArray() };
}

describe('Dedication & About the Author pages', () => {
  it('chooses the most specific page for each book', async () => {
    const { project, book: one } = await createProject('Saga', { kind: 'series', bookTitle: 'Book One' });
    const two = await createBook(project.id, 'Book Two');
    const { project: other } = await createProject('Standalone');

    await saveBookPage(project.id, newBookPage('dedication', { text: 'For everyone', scope: 'project' }));
    await saveBookPage(project.id, newBookPage('dedication', { text: 'For Mum', scope: 'books', bookIds: [two.id] }));
    await saveBookPage(other.id, newBookPage('about', { text: 'I write books.', scope: 'everywhere' }));
    await saveBookPage(other.id, newBookPage('about', { text: 'Only for Standalone', scope: 'project' }));

    const { projects, books } = await all();
    const ded = (bookId: string) => defaultPage(pageChoices('dedication', bookId, project.id, projects, books))?.text;
    expect(ded(one.id)).toBe('For everyone');
    expect(ded(two.id)).toBe('For Mum');

    // "All my books" from another project applies here; that project's own pages are not offered.
    const about = pageChoices('about', one.id, project.id, projects, books);
    expect(about.map((c) => c.page.text)).toEqual(['I write books.']);
    expect(about[0].label).toMatch(/all my books/);

    // Explicit choices: a specific page, or none.
    const forMum = projectPages(projects.find((p) => p.id === project.id)!).find((p) => p.text === 'For Mum')!;
    expect(resolveExtraPages(one.id, project.id, projects, books, { dedication: forMum.id }).dedication).toBe('For Mum');
    expect(resolveExtraPages(one.id, project.id, projects, books, { dedication: null, about: null })).toEqual({ dedication: '', aboutAuthor: '' });
  });

  it('saves pages as tracked project changes, and deletes with undo', async () => {
    const { project } = await createProject('P');
    const page = newBookPage('about', { text: 'Bio' });
    await saveBookPage(project.id, page);
    expect((await db.changes.where('projectId').equals(project.id).toArray()).some((c) => c.table === 'projects')).toBe(true);
    await saveBookPage(project.id, { ...page, text: 'Bio v2' });
    expect(projectPages((await db.projects.get(project.id))!).map((p) => p.text)).toEqual(['Bio v2']);
    const removed = await deleteBookPage(project.id, page.id);
    expect(projectPages((await db.projects.get(project.id))!)).toHaveLength(0);
    await restoreBookPage(project.id, removed!);
    expect(projectPages((await db.projects.get(project.id))!)).toHaveLength(1);
  });

  it('moves per-book text from older versions into shared pages once', async () => {
    const { project, book: one } = await createProject('Saga', { bookTitle: 'One' });
    const two = await createBook(project.id, 'Two');
    const pub = { author: 'A', publisher: '', isbn: '', copyrightYear: '', language: 'en', description: '' };
    await updateRecord('books', one.id, { publishing: { ...pub, dedication: 'For Sam', aboutAuthor: 'Same bio' } });
    await updateRecord('books', two.id, { publishing: { ...pub, dedication: '', aboutAuthor: 'Same bio' } });

    expect(await adoptLegacyBookPages(project.id)).toBe(2);
    const pages = projectPages((await db.projects.get(project.id))!);
    expect(pages.find((p) => p.kind === 'dedication')).toMatchObject({ text: 'For Sam', scope: 'books', bookIds: [one.id] });
    expect(pages.find((p) => p.kind === 'about')).toMatchObject({ text: 'Same bio', scope: 'books', bookIds: [one.id, two.id], name: 'About the Author' });
    expect((await db.books.get(one.id))!.publishing).toMatchObject({ author: 'A', dedication: '', aboutAuthor: '' });
    // Running again changes nothing.
    expect(await adoptLegacyBookPages(project.id)).toBe(0);
    expect(projectPages((await db.projects.get(project.id))!)).toHaveLength(2);
  });

  it('includes the chosen pages in text, Markdown and KDP exports', async () => {
    const { project, book } = await createProject('P', { bookTitle: 'My Book' });
    const scene = (await db.scenes.where('projectId').equals(project.id).toArray())[0];
    await saveSceneContent(scene.id, plainTextToDoc('It began.'));
    const pages = { dedication: 'For Sam', aboutAuthor: 'I live by the sea.' };

    const txt = await exportText(project.id, book.id, pages);
    expect(txt.indexOf('For Sam')).toBeLessThan(txt.indexOf('It began.'));
    expect(txt.indexOf('ABOUT THE AUTHOR')).toBeGreaterThan(txt.indexOf('It began.'));
    expect(await exportText(project.id, book.id)).not.toMatch(/For Sam/);

    const zip = unzipSync(await exportMarkdownZip(project.id, () => pages));
    const names = Object.keys(zip);
    expect(names.some((n) => n.endsWith('My Book/00 - Dedication.md'))).toBe(true);
    const about = names.find((n) => n.endsWith('About the Author.md'))!;
    expect(strFromU8(zip[about])).toMatch(/I live by the sea/);

    const b = (await db.books.get(book.id))!;
    const model = buildPublishModel(b, [], { ...DEFAULT_PUBLISH_OPTIONS }, pages);
    expect(model.info.dedication).toBe('For Sam');
    expect(model.info.aboutAuthor).toBe('I live by the sea.');
  });
});
