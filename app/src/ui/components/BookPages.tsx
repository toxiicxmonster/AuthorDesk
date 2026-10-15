import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../storage/db';
import {
  adoptLegacyBookPages,
  deleteBookPage,
  newBookPage,
  restoreBookPage,
  saveBookPage,
} from '../../storage/bookPages';
import {
  BOOK_PAGE_KINDS,
  BOOK_PAGE_LABELS,
  displayName,
  pageChoices,
  projectPages,
  scopeLabel,
  type BookPage,
  type BookPageKind,
  type ExtraPagesChoice,
} from '../../domain/bookPages';
import { Modal } from './common';
import { reportError, toast } from '../store';
import { href } from '../router';

/** Everything the pickers need: all projects (for "all my books" pages) and all books (for labels). */
function usePageData() {
  return useLiveQuery(async () => {
    const [projects, books] = await Promise.all([db.projects.toArray(), db.books.toArray()]);
    return { projects: projects.filter((p) => !p.archivedAt), books: books.filter((b) => !b.archivedAt) };
  }, []);
}

/** Moves per-book text from older versions into shared pages, once per project per session. */
const adopted = new Set<string>();
function useAdoptLegacy(projectId: string) {
  useEffect(() => {
    if (adopted.has(projectId)) return;
    adopted.add(projectId);
    adoptLegacyBookPages(projectId).catch((e) =>
      reportError(e, 'Could not update your dedication and bio pages'),
    );
  }, [projectId]);
}

// ------------------------------------------------------------------ Home card

export function BookPagesCard({ projectId }: { projectId: string }) {
  useAdoptLegacy(projectId);
  const data = usePageData();
  const [editing, setEditing] = useState<{ page: BookPage; projectId: string } | null>(null);
  if (!data) return null;
  const projectBooks = data.books.filter((b) => b.projectId === projectId).sort((a, b) => a.order - b.order);
  const own = data.projects.find((p) => p.id === projectId);
  const rows: { page: BookPage; projectId: string; projectName?: string }[] = [];
  if (own) for (const page of projectPages(own)) rows.push({ page, projectId });
  for (const p of data.projects) {
    if (p.id === projectId) continue;
    for (const page of projectPages(p))
      if (page.scope === 'everywhere') rows.push({ page, projectId: p.id, projectName: p.name });
  }

  const remove = async (row: (typeof rows)[number]) => {
    try {
      const removed = await deleteBookPage(row.projectId, row.page.id);
      if (removed)
        toast(`Deleted “${displayName(removed)}”`, {
          action: { label: 'Undo', run: () => void restoreBookPage(row.projectId, removed) },
        });
    } catch (e) {
      reportError(e, 'Could not delete the page');
    }
  };

  return (
    <section className="card book-pages">
      <h2>Book pages</h2>
      <p className="muted small">
        Dedication, epigraph, acknowledgements, About the Author and Also by: write these once and choose them when you
        export (Word, text, Markdown and Amazon KDP). A page can apply to all your books, this project, or specific books.
      </p>
      <div className="book-pages-groups">
        {BOOK_PAGE_KINDS.map((kind) => {
          const list = rows.filter((r) => r.page.kind === kind);
          return (
            <div key={kind} className="book-pages-group">
              <h3>{BOOK_PAGE_LABELS[kind]}</h3>
              {list.length ? (
                <ul className="book-pages-list">
                  {list.map((r) => (
                    <li key={r.page.id}>
                      <button
                        className="link-like"
                        onClick={() => setEditing({ page: r.page, projectId: r.projectId })}
                      >
                        <strong>{displayName(r.page)}</strong>
                      </button>
                      <span className="muted small">
                        For: {scopeLabel(r.page, data.books, r.projectName)}
                        {r.projectName ? ` (saved in “${r.projectName}”)` : ''}
                      </span>
                      {!r.page.text.trim() && <span className="muted small"> · empty</span>}
                      <span className="row gap">
                        <button
                          className="small"
                          onClick={() => setEditing({ page: r.page, projectId: r.projectId })}
                        >
                          Edit
                        </button>
                        <button className="small" onClick={() => void remove(r)}>
                          Delete
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">None yet.</p>
              )}
              <button className="small" onClick={() => setEditing({ page: newBookPage(kind), projectId })}>
                + New {NEW_LABEL[kind]}
              </button>
            </div>
          );
        })}
      </div>
      {editing && (
        <BookPageEditor
          page={editing.page}
          books={data.books
            .filter((b) => b.projectId === editing.projectId)
            .sort((a, b) => a.order - b.order)}
          isNew={!rows.some((r) => r.page.id === editing.page.id)}
          onSave={async (p) => {
            try {
              await saveBookPage(editing.projectId, p);
              setEditing(null);
              toast('Saved');
            } catch (e) {
              reportError(e, 'Could not save the page');
            }
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {projectBooks.length === 0 && (
        <p className="muted small">Add a book to this project to choose specific books.</p>
      )}
    </section>
  );
}

const NEW_LABEL: Record<BookPageKind, string> = {
  dedication: 'dedication',
  epigraph: 'epigraph',
  acknowledgements: 'acknowledgements page',
  about: 'About the Author page',
  alsoBy: '“Also by” page',
};
const PLACEHOLDER: Record<BookPageKind, string> = {
  dedication: 'For…',
  epigraph: 'A quotation that sets the tone for the book.\n— Who said it',
  acknowledgements: 'Thank you to…',
  about: 'A few sentences about you, where readers can find more of your books…',
  alsoBy: 'Your other books, one per line (a series name on its own line works as a heading).',
};
const NAME_EXAMPLE: Record<BookPageKind, string> = {
  dedication: 'e.g. For my family',
  epigraph: 'e.g. Rilke quote',
  acknowledgements: 'e.g. Book 1 thanks',
  about: 'e.g. Short bio',
  alsoBy: 'e.g. Full list',
};

function BookPageEditor({
  page,
  books,
  isNew,
  onSave,
  onClose,
}: {
  page: BookPage;
  books: { id: string; title: string }[];
  isNew: boolean;
  onSave: (p: BookPage) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(page);
  const set = (p: Partial<BookPage>) => setDraft((d) => ({ ...d, ...p }));
  const label = BOOK_PAGE_LABELS[draft.kind];
  const noBooks = draft.scope === 'books' && !draft.bookIds.length;
  return (
    <Modal
      title={`${isNew ? 'New' : 'Edit'} ${NEW_LABEL[draft.kind]}`}
      onClose={onClose}
    >
      <label className="field">
        <span>{label} text</span>
        <textarea
          rows={draft.kind === 'dedication' || draft.kind === 'epigraph' ? 4 : 8}
          value={draft.text}
          autoFocus
          placeholder={PLACEHOLDER[draft.kind]}
          onChange={(e) => set({ text: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Name (just for you, optional)</span>
        <input
          value={draft.name}
          placeholder={NAME_EXAMPLE[draft.kind]}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <fieldset className="field">
        <legend>Use it for</legend>
        <label className="check">
          <input
            type="radio"
            name="scope"
            checked={draft.scope === 'everywhere'}
            onChange={() => set({ scope: 'everywhere' })}
          />{' '}
          All my books (every project)
        </label>
        <label className="check">
          <input
            type="radio"
            name="scope"
            checked={draft.scope === 'project'}
            onChange={() => set({ scope: 'project' })}
          />{' '}
          All books in this project
        </label>
        <label className="check">
          <input
            type="radio"
            name="scope"
            checked={draft.scope === 'books'}
            onChange={() => set({ scope: 'books' })}
            disabled={!books.length}
          />{' '}
          Only these books:
        </label>
        {draft.scope === 'books' && (
          <div className="check-grid indent">
            {books.map((b) => (
              <label key={b.id} className="check">
                <input
                  type="checkbox"
                  checked={draft.bookIds.includes(b.id)}
                  onChange={(e) =>
                    set({
                      bookIds: e.target.checked
                        ? [...draft.bookIds, b.id]
                        : draft.bookIds.filter((x) => x !== b.id),
                    })
                  }
                />{' '}
                {b.title}
              </label>
            ))}
          </div>
        )}
        <span className="muted small">
          You can still pick any page by hand when exporting; this sets which one is chosen automatically.
        </span>
      </fieldset>
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!draft.text.trim() || noBooks} onClick={() => onSave(draft)}>
          Save
        </button>
      </div>
      {noBooks && <p className="danger-text small">Choose at least one book.</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------ export picker

export type { ExtraPagesChoice };

export function useExtraPagesData(projectId: string) {
  useAdoptLegacy(projectId);
  return usePageData();
}

/** Selects for an export dialog: which page of each kind to include for a book. Kinds with no pages anywhere are left out. */
export function ExtraPagesPicker({
  projectId,
  bookId,
  value,
  onChange,
}: {
  projectId: string;
  bookId: string;
  value: ExtraPagesChoice;
  onChange: (v: ExtraPagesChoice) => void;
}) {
  const data = useExtraPagesData(projectId);
  if (!data) return null;
  const select = (kind: BookPageKind) => {
    const key = kind;
    const choices = pageChoices(kind, bookId, projectId, data.projects, data.books);
    if (!choices.length && kind !== 'dedication' && kind !== 'about') return null;
    const auto = choices.find((c) => c.applies);
    const current = value[key];
    const v = current === undefined ? 'auto' : current === null ? 'none' : current;
    return (
      <label className="field" key={kind}>
        <span>{BOOK_PAGE_LABELS[kind]}</span>
        <select
          value={choices.some((c) => c.page.id === v) || v === 'auto' || v === 'none' ? v : 'auto'}
          onChange={(e) =>
            onChange({
              ...value,
              [key]:
                e.target.value === 'auto' ? undefined : e.target.value === 'none' ? null : e.target.value,
            })
          }
        >
          <option value="auto">
            {auto ? `Automatic: ${displayName(auto.page)}` : 'Automatic (none set for this book)'}
          </option>
          <option value="none">Leave it out</option>
          {choices.map((c) => (
            <option key={c.page.id} value={c.page.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
    );
  };
  return (
    <div className="extra-pages">
      <div className="extra-pages-fields">
        {BOOK_PAGE_KINDS.map(select)}
      </div>
      <span className="muted small">
        Write and manage these (and epigraphs, acknowledgements and “Also by” pages) on the <a href={href(projectId, 'home')}>Home</a> page.
      </span>
    </div>
  );
}
