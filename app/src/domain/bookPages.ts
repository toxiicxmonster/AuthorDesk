import { z } from 'zod';
import type { Book, Project } from './schema';

/**
 * Extra book pages written once and reused across books: dedications and "About the Author".
 * Stored on the project record (so they are included in backups and sync). A page applies to:
 * - 'everywhere': every book in every project (typical for an author bio),
 * - 'project':    every book in its project,
 * - 'books':      only the listed books.
 */
export const BOOK_PAGE_KINDS = ['dedication', 'about'] as const;
export type BookPageKind = (typeof BOOK_PAGE_KINDS)[number];

export const BOOK_PAGE_LABELS: Record<BookPageKind, string> = {
  dedication: 'Dedication',
  about: 'About the Author',
};

export const bookPageSchema = z.looseObject({
  id: z.string().min(1).max(64),
  kind: z.enum(BOOK_PAGE_KINDS),
  /** The author's own label, e.g. "Bio — short" or "For Mum". */
  name: z.string().default(''),
  text: z.string().default(''),
  scope: z.enum(['everywhere', 'project', 'books']).default('project'),
  bookIds: z.array(z.string()).default([]),
  updatedAt: z.string().default(''),
});
export type BookPage = z.infer<typeof bookPageSchema>;

export type BookPageScope = BookPage['scope'];

/** Pages stored on a project (older projects have none). */
export function projectPages(project: Pick<Project, 'id'> & { bookPages?: unknown }): BookPage[] {
  const raw = Array.isArray(project.bookPages) ? project.bookPages : [];
  return raw.flatMap((p) => {
    const r = bookPageSchema.safeParse(p);
    return r.success ? [r.data] : [];
  });
}

export interface PageChoice {
  page: BookPage;
  projectId: string;
  /** Shown in pickers, e.g. "Short bio · all my books". */
  label: string;
  /** Applies to this book by its scope (as opposed to merely being available). */
  applies: boolean;
}

export function displayName(p: BookPage): string {
  const first = p.text.trim().split('\n')[0] ?? '';
  return p.name.trim() || (first.length > 40 ? `${first.slice(0, 40)}…` : first) || BOOK_PAGE_LABELS[p.kind];
}

export function scopeLabel(p: BookPage, books: Pick<Book, 'id' | 'title'>[], otherProject?: string): string {
  if (p.scope === 'everywhere') return 'all my books';
  if (p.scope === 'project') return otherProject ? `all books in “${otherProject}”` : 'all books in this project';
  const titles = p.bookIds.map((id) => books.find((b) => b.id === id)?.title).filter(Boolean) as string[];
  return titles.length ? titles.join(', ') : 'no books selected';
}

/**
 * Every page of a kind that could be used for a book, best match first:
 * pages for this specific book, then for this whole project, then "all my books" pages (from any project),
 * then everything else from this project (available to choose, but not applied by default).
 */
export function pageChoices(
  kind: BookPageKind,
  bookId: string,
  projectId: string,
  projects: (Pick<Project, 'id' | 'name'> & { bookPages?: unknown; archivedAt?: string | null })[],
  books: Pick<Book, 'id' | 'title'>[],
): PageChoice[] {
  const rank = (p: BookPage, own: boolean): number => {
    if (own && p.scope === 'books' && p.bookIds.includes(bookId)) return 0;
    if (own && p.scope === 'project') return 1;
    if (p.scope === 'everywhere') return 2;
    return own ? 3 : 9;
  };
  const out: (PageChoice & { r: number })[] = [];
  for (const proj of projects) {
    if (proj.archivedAt) continue;
    const own = proj.id === projectId;
    for (const page of projectPages(proj)) {
      if (page.kind !== kind || !page.text.trim()) continue;
      const r = rank(page, own);
      if (r === 9) continue;
      out.push({ page, projectId: proj.id, r, applies: r <= 2, label: `${displayName(page)} · ${scopeLabel(page, books, own ? undefined : proj.name)}` });
    }
  }
  return out.sort((a, b) => a.r - b.r || displayName(a.page).localeCompare(displayName(b.page))).map(({ r: _r, ...c }) => c);
}

/** The page used by default for a book, or null when none applies. */
export function defaultPage(choices: PageChoice[]): BookPage | null {
  return choices.find((c) => c.applies)?.page ?? null;
}

/** Text of the chosen pages for an export. `undefined` choice = the default; `null` = none. */
export interface ExtraPagesText {
  dedication: string;
  aboutAuthor: string;
}

export function resolveExtraPages(
  bookId: string,
  projectId: string,
  projects: Parameters<typeof pageChoices>[3],
  books: Pick<Book, 'id' | 'title'>[],
  chosen: { dedication?: string | null; about?: string | null } = {},
): ExtraPagesText {
  const pick = (kind: BookPageKind, choice: string | null | undefined) => {
    const choices = pageChoices(kind, bookId, projectId, projects, books);
    if (choice === null) return '';
    const page = choice === undefined ? defaultPage(choices) : (choices.find((c) => c.page.id === choice)?.page ?? null);
    return page?.text.trim() ?? '';
  };
  return { dedication: pick('dedication', chosen.dedication), aboutAuthor: pick('about', chosen.about) };
}
