import { db } from './db';
import { updateRecord } from './repo';
import { newId } from '../domain/ids';
import { projectPages, type BookPage, type BookPageKind } from '../domain/bookPages';
import type { Book, Project } from '../domain/schema';

/** Change the list of extra pages on a project in one tracked (synced, undo-safe) update. */
async function editPages(projectId: string, edit: (pages: BookPage[]) => BookPage[]): Promise<void> {
  await db.transaction('rw', [db.projects, db.changes], async () => {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('That project no longer exists.');
    await updateRecord('projects', projectId, { bookPages: edit(projectPages(project)) } as Partial<Project>);
  });
}

export function newBookPage(kind: BookPageKind, over: Partial<BookPage> = {}): BookPage {
  return { id: newId(), kind, name: '', text: '', scope: kind === 'about' ? 'everywhere' : 'project', bookIds: [], updatedAt: new Date().toISOString(), ...over };
}

export async function saveBookPage(projectId: string, page: BookPage): Promise<void> {
  const next = { ...page, updatedAt: new Date().toISOString() };
  await editPages(projectId, (pages) => (pages.some((p) => p.id === page.id) ? pages.map((p) => (p.id === page.id ? next : p)) : [...pages, next]));
}

export async function deleteBookPage(projectId: string, pageId: string): Promise<BookPage | null> {
  let removed: BookPage | null = null;
  await editPages(projectId, (pages) => {
    removed = pages.find((p) => p.id === pageId) ?? null;
    return pages.filter((p) => p.id !== pageId);
  });
  return removed;
}

/** Undo for a deletion: put the page back where it was (by id). */
export async function restoreBookPage(projectId: string, page: BookPage): Promise<void> {
  await editPages(projectId, (pages) => (pages.some((p) => p.id === page.id) ? pages : [...pages, page]));
}

/**
 * Earlier versions kept a dedication and an author bio on each book (KDP "Book details").
 * Move them into the project's pages, once: identical text shared by several books becomes one page for those books.
 */
export async function adoptLegacyBookPages(projectId: string): Promise<number> {
  const books = (await db.books.where('projectId').equals(projectId).toArray()).filter((b) => !b.archivedAt).sort((a, b) => a.order - b.order);
  const legacy = books.filter((b) => b.publishing && (b.publishing.dedication?.trim() || b.publishing.aboutAuthor?.trim()));
  if (!legacy.length) return 0;
  const created: BookPage[] = [];
  const add = (kind: BookPageKind, text: string, book: Book) => {
    const same = created.find((p) => p.kind === kind && p.text.trim() === text.trim());
    if (same) same.bookIds.push(book.id);
    else created.push(newBookPage(kind, { text: text.trim(), scope: 'books', bookIds: [book.id], name: `${kind === 'about' ? 'Bio' : 'Dedication'} from “${book.title}”` }));
  };
  for (const b of legacy) {
    if (b.publishing!.dedication?.trim()) add('dedication', b.publishing!.dedication, b);
    if (b.publishing!.aboutAuthor?.trim()) add('about', b.publishing!.aboutAuthor, b);
  }
  // One book using it → named after the book; shared → generic name.
  for (const p of created) if (p.bookIds.length > 1) p.name = p.kind === 'about' ? 'About the Author' : 'Dedication';
  await db.transaction('rw', [db.projects, db.books, db.changes], async () => {
    await editPages(projectId, (pages) => {
      const fresh = created.filter((c) => !pages.some((p) => p.kind === c.kind && p.text.trim() === c.text));
      return [...pages, ...fresh];
    });
    for (const b of legacy) await updateRecord('books', b.id, { publishing: { ...b.publishing!, dedication: '', aboutAuthor: '' } });
  });
  return created.length;
}
