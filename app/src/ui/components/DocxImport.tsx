import { useRef, useState, type ReactNode } from 'react';
import { DocxError, isGoogleShortcut, readDocx, type DocxBook } from '../../importExport/docxImport';
import { importChapters } from '../../importExport/textImport';
import { createProject, deleteRecord } from '../../storage/repo';
import { db } from '../../storage/db';
import { flushAllEdits } from '../../editor/EditorContext';
import { Modal } from './common';
import { navigate } from '../router';
import { reportError, toast } from '../store';

const GOOGLE_HELP = 'In Google Docs, choose File → Download → Microsoft Word (.docx), then pick that file here.';

/**
 * Bring in a Word document or a Google Doc (downloaded as .docx): as a new book, or as more chapters in this one.
 * `pick()` opens the file chooser; `modal` shows what was found before anything is added.
 */
export function useDocxImport(target: { projectId: string; bookId: string } | null) {
  const input = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<{ book: DocxBook; fileName: string } | null>(null);

  const load = async (file: File) => {
    if (isGoogleShortcut(file.name)) return toast(`That’s a shortcut to a Google Doc, not the document itself. ${GOOGLE_HELP}`, { kind: 'error', ms: 12000 });
    if (/\.doc$/i.test(file.name)) return toast('That’s an old-style Word file (.doc). Open it in Word and save it as “Word Document (.docx)”, then pick that.', { kind: 'error', ms: 12000 });
    if (file.size > 200 * 1024 * 1024) return toast('That file is larger than 200 MB.', { kind: 'error' });
    try {
      setFound({ book: readDocx(new Uint8Array(await file.arrayBuffer())), fileName: file.name });
    } catch (e) {
      if (e instanceof DocxError) toast(e.message, { kind: 'error', ms: 12000 });
      else reportError(e, 'Could not read that file');
    }
  };

  const modal: ReactNode = (
    <>
      <input
        ref={input}
        type="file"
        accept=".docx,.gdoc,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void load(f);
        }}
      />
      {found && <DocxPreview found={found} target={target} onClose={() => setFound(null)} />}
    </>
  );
  return { pick: () => input.current?.click(), modal };
}

function DocxPreview({ found, target, onClose }: { found: { book: DocxBook; fileName: string }; target: { projectId: string; bookId: string } | null; onClose: () => void }) {
  const { book, fileName } = found;
  const [title, setTitle] = useState(book.title ?? fileName.replace(/\.docx$/i, ''));
  const [chosen, setChosen] = useState(() => new Set(book.chapters.flatMap((c, i) => (c.frontMatter ? [] : [i]))));
  const [busy, setBusy] = useState(false);
  const picked = book.chapters.filter((_, i) => chosen.has(i));
  const words = picked.reduce((n, c) => n + c.words, 0);

  const go = async () => {
    if (!picked.length) return toast('Tick at least one chapter.');
    setBusy(true);
    try {
      await flushAllEdits();
      let projectId: string;
      let bookId: string;
      if (target) ({ projectId, bookId } = target);
      else {
        const made = await createProject(title.trim() || 'Untitled book');
        projectId = made.project.id;
        bookId = made.book.id;
      }
      const existing = (await db.chapters.where('bookId').equals(bookId).toArray()).filter((c) => !c.archivedAt);
      const before = new Set(existing.map((c) => c.id));
      await importChapters(projectId, bookId, picked.map((c) => ({ title: c.title, doc: c.doc })));
      // A new book's untouched "Chapter 1" would sit empty in front of the imported ones.
      if (existing.length === 1 && !existing[0].summary.trim()) {
        const scenes = await db.scenes.where('chapterId').equals(existing[0].id).toArray();
        if (scenes.every((sc) => !sc.plainText.trim() && !sc.notes.trim() && !sc.summary.trim())) {
          for (const sc of scenes) await deleteRecord('scenes', sc.id);
          await deleteRecord('chapters', existing[0].id);
        }
      }
      const firstNew = (await db.chapters.where('bookId').equals(bookId).toArray()).filter((c) => !before.has(c.id)).sort((a, b) => a.order - b.order)[0];
      const scene = firstNew && (await db.scenes.where('chapterId').equals(firstNew.id).first());
      onClose();
      toast(`${target ? 'Added' : 'Your book is ready:'} ${picked.length} chapter${picked.length === 1 ? '' : 's'}, ${words.toLocaleString()} words.`);
      navigate(projectId, 'write', scene?.id);
    } catch (e) {
      reportError(e, 'Could not bring in the file');
      setBusy(false);
    }
  };

  return (
    <Modal title={target ? 'Add chapters from a Word file' : 'Start a book from a Word file'} onClose={onClose} wide>
      <p className="small muted">
        From <strong>{fileName}</strong>. Chapters start at the document’s headings (or lines like “Chapter 3”). Bold, italic, scene breaks, highlights and comments
        come across; fonts and spacing don’t, since your export settings decide the book’s look.
      </p>
      {!target && (
        <label className="field">
          <span>Book title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
      )}
      <fieldset className="field docx-chapters">
        <legend>
          {book.chapters.length} chapter{book.chapters.length === 1 ? '' : 's'} found
        </legend>
        <ul className="plain">
          {book.chapters.map((c, i) => (
            <li key={i}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={chosen.has(i)}
                  onChange={(e) =>
                    setChosen((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(i);
                      else n.delete(i);
                      return n;
                    })
                  }
                />
                <span className="grow">
                  {c.title}
                  {c.frontMatter && <span className="muted small"> (a title page or front matter? left out unless you tick it)</span>}
                </span>
                <span className="muted small">{c.words.toLocaleString()} words</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {(book.comments > 0 || book.highlights > 0) && (
        <p className="small">
          Also bringing {[book.comments && `${book.comments} comment${book.comments === 1 ? '' : 's'}`, book.highlights && `${book.highlights} highlight${book.highlights === 1 ? '' : 's'}`].filter(Boolean).join(' and ')}{' '}
          (only you see them; they’re left out of exports).
        </p>
      )}
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || !picked.length} onClick={() => void go()}>
          {busy ? 'Bringing it in…' : target ? `Add ${picked.length} chapter${picked.length === 1 ? '' : 's'}` : `Create the book (${words.toLocaleString()} words)`}
        </button>
      </div>
    </Modal>
  );
}

export { GOOGLE_HELP };
