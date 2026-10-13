import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Modal, CommitInput } from './common';
import { db } from '../../storage/db';
import { renameBook, updateRecord } from '../../storage/repo';
import { bookManuscript } from '../../importExport/exporters';
import type { ProjectData } from '../../importExport/archive';
import {
  buildPublishModel,
  DEFAULT_PUBLISH_OPTIONS,
  preflight,
  printLayout,
  publishingInfo,
  slug,
  TRIM_SIZES,
  type HeadingStyle,
  type PublishingInfo,
  type PublishOptions,
} from '../../importExport/publish';
import { buildEpub, type EpubCover } from '../../importExport/epub';
import { buildKdpDocx } from '../../importExport/kdpDocx';
import { saveFile } from '../../importExport/download';
import { flushAllEdits } from '../../editor/EditorContext';
import { reportError, toast } from '../store';
import type { Book } from '../../domain/schema';
import { resolveExtraPages } from '../../domain/bookPages';
import { ExtraPagesPicker, useExtraPagesData, type ExtraPagesChoice } from './BookPages';

type Format = 'epub' | 'ebook-docx' | 'print';

const FONTS = ['Garamond', 'Georgia', 'Palatino Linotype', 'Book Antiqua', 'Times New Roman'];
const LANGS: [string, string][] = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['nl', 'Dutch'],
];
const OPTIONS_KEY = 'authordesk.kdpOptions';

interface SavedChoices {
  format: Format;
  trim: string;
  font: string;
  fontSize: number;
  chaptersOnRight: boolean;
  options: PublishOptions;
}

function loadChoices(): SavedChoices {
  const d: SavedChoices = { format: 'epub', trim: '6x9', font: 'Garamond', fontSize: 11, chaptersOnRight: true, options: DEFAULT_PUBLISH_OPTIONS };
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as Partial<SavedChoices>;
    // Options added in later versions get their defaults.
    return { ...d, ...saved, options: { ...DEFAULT_PUBLISH_OPTIONS, ...(saved.options ?? {}) } };
  } catch {
    return d;
  }
}

export function KdpExportDialog({ projectId, bookId, onClose }: { projectId: string; bookId: string; onClose: () => void }) {
  const [choices, setChoices] = useState<SavedChoices>(loadChoices);
  const [cover, setCover] = useState<(EpubCover & { name: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Format | null>(null);
  const [pageChoice, setPageChoice] = useState<ExtraPagesChoice>({});
  const pageData = useExtraPagesData(projectId);
  const set = (p: Partial<SavedChoices>) => setChoices((c) => ({ ...c, ...p }));
  const setOpt = (p: Partial<PublishOptions>) => setChoices((c) => ({ ...c, options: { ...c.options, ...p } }));

  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(choices));
    } catch {
      /* ignore */
    }
  }, [choices]);

  const data = useLiveQuery(async () => {
    const [book, chapters, scenes] = await Promise.all([
      db.books.get(bookId),
      db.chapters.where('bookId').equals(bookId).toArray(),
      db.scenes.where('projectId').equals(projectId).toArray(),
    ]);
    if (!book) return null;
    return { book, manuscript: bookManuscript({ books: [book], chapters, scenes } as unknown as ProjectData, bookId) };
  }, [bookId, projectId]);

  // Dedication / About the Author come from the pages managed on Home (automatic choice, a specific page, or none).
  const pages = useMemo(
    () => (pageData ? resolveExtraPages(bookId, projectId, pageData.projects, pageData.books, pageChoice) : { dedication: '', aboutAuthor: '' }),
    [pageData, bookId, projectId, pageChoice],
  );
  const model = useMemo(
    () =>
      data
        ? buildPublishModel(data.book, data.manuscript.chapters, { ...choices.options, includeDedication: !!pages.dedication, includeAboutAuthor: !!pages.aboutAuthor }, pages)
        : null,
    [data, choices.options, pages],
  );
  const trim = TRIM_SIZES.find((t) => t.id === choices.trim) ?? TRIM_SIZES[3];
  const layout = useMemo(() => (model ? printLayout(model, trim, choices.fontSize) : null), [model, trim, choices.fontSize]);
  const checks = useMemo(() => (model ? preflight(model, choices.format === 'print' ? 'print' : 'ebook', layout ?? undefined) : []), [model, choices.format, layout]);

  if (!data || !model) return null;
  const book = data.book;
  const info = publishingInfo(book);
  const saveInfo = (patch: Partial<PublishingInfo>) => void updateRecord('books', book.id, { publishing: { ...info, ...patch } } as Partial<Book>);

  const exportNow = async () => {
    setBusy(true);
    try {
      await flushAllEdits();
      const name = slug(book.title);
      if (choices.format === 'epub') {
        await saveFile(buildEpub(model, book.id, cover ?? undefined), `${name} - Kindle.epub`, 'application/epub+zip');
      } else {
        const bytes = await buildKdpDocx(model, { target: choices.format === 'print' ? 'print' : 'ebook', layout: layout ?? undefined, font: choices.font, chaptersOnRight: choices.chaptersOnRight });
        const suffix = choices.format === 'print' ? `Paperback ${trim.width}x${trim.height}` : 'Kindle';
        await saveFile(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), `${name} - ${suffix}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      }
      setDone(choices.format);
    } catch (e) {
      reportError(e, 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Modal title="Your manuscript is ready" onClose={onClose} wide>
        <h3>Next steps on Amazon KDP</h3>
        <ol className="kdp-steps">
          <li>
            Go to <strong>kdp.amazon.com</strong> → Bookshelf → <em>{done === 'print' ? '+ Paperback (or Hardcover)' : '+ Kindle eBook'}</em> (or open your existing title).
          </li>
          <li>Fill in the book details (title, author, description, keywords).</li>
          <li>
            On the <em>{done === 'print' ? 'Paperback Content' : 'Kindle eBook Content'}</em> page, upload the file you just saved as the <strong>manuscript</strong>.
            {done === 'print' && (
              <>
                {' '}
                Choose trim size <strong>{trim.width} × {trim.height} in</strong>, <strong>No bleed</strong>, and your paper colour.
              </>
            )}
          </li>
          {done === 'print' ? (
            <>
              <li>
                Open the <strong>Print Previewer</strong> and page through every spread — it flags anything outside the margins.
              </li>
              <li>
                Make your cover with KDP’s Cover Creator, or download KDP’s cover template for <strong>{trim.width} × {trim.height} in</strong> and about{' '}
                <strong>{layout?.estimatedPages} pages</strong> (KDP shows the exact count after upload).
              </li>
            </>
          ) : (
            <>
              <li>Upload your cover image separately (KDP recommends 2560 × 1600 px, JPEG).</li>
              <li>
                Use the <strong>Kindle Previewer</strong> link to check the book on phone, tablet and Kindle screens.
              </li>
            </>
          )}
        </ol>
        <p className="small muted">Tip: keep your AuthorDesk book as the master copy. If you change something, export again and re-upload — KDP replaces the old file.</p>
        <div className="dialog-actions">
          <button onClick={() => setDone(null)}>Export another format</button>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  const problems = checks.filter((c) => c.level === 'problem');
  return (
    <Modal title="Publish on Amazon KDP" onClose={onClose} wide>
      <div className="kdp-grid">
        <section>
          <h3>1. What are you publishing?</h3>
          <div className="format-cards" role="radiogroup" aria-label="Format">
            {(
              [
                ['epub', 'Kindle eBook', 'EPUB — Amazon’s recommended eBook format. Reflows to any screen size.'],
                ['ebook-docx', 'Kindle eBook (Word)', 'A .docx KDP converts for Kindle. Handy if you want to edit it in Word first.'],
                ['print', 'Paperback / hardcover', 'A print-ready .docx interior: exact trim size, KDP margins, page numbers.'],
              ] as [Format, string, string][]
            ).map(([id, title, desc]) => (
              <label key={id} className={`format-card${choices.format === id ? ' on' : ''}`}>
                <input type="radio" name="kdp-format" checked={choices.format === id} onChange={() => set({ format: id })} />
                <strong>{title}</strong>
                <span className="muted small">{desc}</span>
              </label>
            ))}
          </div>

          {choices.format === 'print' && (
            <div className="two-col">
              <label className="field">
                <span>Trim size</span>
                <select value={choices.trim} onChange={(e) => set({ trim: e.target.value })}>
                  {TRIM_SIZES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Font</span>
                <select value={choices.font} onChange={(e) => set({ font: e.target.value })}>
                  {FONTS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Text size</span>
                <select value={choices.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })}>
                  {[10, 10.5, 11, 11.5, 12].map((s) => (
                    <option key={s} value={s}>
                      {s} pt{s === 11 ? ' (typical for novels)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="check kdp-right">
                <input type="checkbox" checked={choices.chaptersOnRight} onChange={(e) => set({ chaptersOnRight: e.target.checked })} /> Start chapters on a right-hand page
              </label>
            </div>
          )}
          {choices.format === 'epub' && (
            <div className="field">
              <span>Cover image inside the eBook (optional)</span>
              <div className="row gap">
                <label className="button small">
                  {cover ? 'Change image…' : 'Choose image…'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    hidden
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      if (f.size > 10 * 1024 * 1024) return toast('Cover images must be under 10 MB.', { kind: 'error' });
                      setCover({ bytes: new Uint8Array(await f.arrayBuffer()), mediaType: f.type === 'image/png' ? 'image/png' : 'image/jpeg', name: f.name });
                    }}
                  />
                </label>
                {cover && (
                  <>
                    <span className="small">{cover.name}</span>
                    <button className="small" onClick={() => setCover(null)}>
                      Remove
                    </button>
                  </>
                )}
              </div>
              <span className="muted small">You also upload the cover separately on KDP.</span>
            </div>
          )}

          <h3>2. How it looks</h3>
          <label className="field">
            <span>Chapter headings</span>
            <select value={choices.options.headingStyle} onChange={(e) => setOpt({ headingStyle: e.target.value as HeadingStyle })}>
              <option value="as-written">Use my chapter titles as they are</option>
              <option value="number-title">“Chapter 1” above each title</option>
              <option value="words-title">“Chapter One” above each title</option>
              <option value="number-only">Numbers only (“Chapter 1”)</option>
            </select>
          </label>
          <div className="check-grid">
            <label className="check">
              <input type="checkbox" checked={choices.options.smartPunctuation} onChange={(e) => setOpt({ smartPunctuation: e.target.checked })} /> Curly quotes, em dashes & ellipses
            </label>
            <label className="check">
              <input type="checkbox" checked={choices.options.includeTitlePage} onChange={(e) => setOpt({ includeTitlePage: e.target.checked })} /> Title page
            </label>
            <label className="check">
              <input type="checkbox" checked={choices.options.includeCopyright} onChange={(e) => setOpt({ includeCopyright: e.target.checked })} /> Copyright page
            </label>
            <label className="check">
              <input type="checkbox" checked={choices.options.includeToc} onChange={(e) => setOpt({ includeToc: e.target.checked })} /> Table of contents
            </label>
            {choices.format === 'print' && choices.options.includeToc && (
              <label className="check" title="Microsoft Word fills in the page numbers when you open the file.">
                <input type="checkbox" checked={choices.options.tocPageNumbers} onChange={(e) => setOpt({ tocPageNumbers: e.target.checked })} /> …with page numbers (needs Word)
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={choices.options.sceneTitles} onChange={(e) => setOpt({ sceneTitles: e.target.checked })} /> Show scene titles
            </label>
          </div>
          <ExtraPagesPicker projectId={projectId} bookId={bookId} value={pageChoice} onChange={setPageChoice} />
        </section>

        <section>
          <h3>3. Book details</h3>
          <div className="two-col">
            <CommitInput label="Title" value={book.title} onCommit={(v) => v.trim() && void renameBook(book.id, v.trim())} />
            <CommitInput label="Subtitle (optional)" value={book.subtitle} onCommit={(v) => void updateRecord('books', book.id, { subtitle: v })} />
            <CommitInput label="Author name (as on the cover)" value={info.author} onCommit={(v) => saveInfo({ author: v.trim() })} />
            <CommitInput label="Copyright year" value={info.copyrightYear} onCommit={(v) => saveInfo({ copyrightYear: v.trim() })} />
            <CommitInput label="Publisher / imprint (optional)" value={info.publisher} onCommit={(v) => saveInfo({ publisher: v.trim() })} />
            <CommitInput label={choices.format === 'print' ? 'ISBN (optional — KDP can give you a free one)' : 'ISBN (optional — not needed for Kindle)'} value={info.isbn} onCommit={(v) => saveInfo({ isbn: v.trim() })} />
            <label className="field">
              <span>Language</span>
              <select value={info.language} onChange={(e) => saveInfo({ language: e.target.value })}>
                {LANGS.map(([c, n]) => (
                  <option key={c} value={c}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </div>

      <div className="kdp-footer">
      <section className="preflight">
        <h3>4. Check before publishing</h3>
        <p className="small">
          <strong>{model.chapters.length}</strong> chapters · <strong>{model.words.toLocaleString()}</strong> words
          {choices.format === 'print' && layout && (
            <>
              {' '}
              · about <strong>{layout.estimatedPages}</strong> pages at {trim.width} × {trim.height} in · margins: inside {layout.margins.inside.toFixed(3)} in (KDP minimum{' '}
              {(layout.margins.inside - 0.25).toFixed(3)} in), outside {layout.margins.outside} in, top/bottom {layout.margins.top} in
            </>
          )}
        </p>
        {checks.length === 0 ? (
          <p className="ok-text small">✓ Everything looks ready.</p>
        ) : (
          <ul className="small plain">
            {checks.map((c, i) => (
              <li key={i} className={c.level === 'problem' ? 'warn-text' : ''}>
                {c.level === 'problem' ? '⚠ ' : '• '}
                {c.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || !model.chapters.length} onClick={() => void exportNow()}>
          {busy ? 'Building…' : problems.length ? `Export anyway (${problems.length} to fix)` : choices.format === 'epub' ? 'Save Kindle eBook (.epub)' : choices.format === 'print' ? 'Save print interior (.docx)' : 'Save Kindle eBook (.docx)'}
        </button>
      </div>
      </div>
    </Modal>
  );
}
