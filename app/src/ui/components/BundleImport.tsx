import { useEffect, useRef, useState } from 'react';
import { Modal } from './common';
import { applyImportPlan, buildImportPlan, filesFromPicker, filesFromZip, starterTemplateZip, type BundleReport, type ImportPlan } from '../../importExport/bundleImport';
import { saveFile } from '../../importExport/download';
import { useBooks } from '../data';
import { reportError, toast } from '../store';
import { flushAllEdits } from '../../editor/EditorContext';
import { navigate } from '../router';
import { REFERENCE_TYPE_LABELS } from '../../domain/referenceTemplates';

const n = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** "Import your own files": folder or zip of chapters + spreadsheets, previewed before anything changes. */
export function BundleImportCard({ projectId, autoOpenHelp = false }: { projectId: string; autoOpenHelp?: boolean }) {
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [help, setHelp] = useState(autoOpenHelp);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoOpenHelp) ref.current?.scrollIntoView({ block: 'center' });
  }, [autoOpenHelp]);

  const load = async (get: () => Promise<{ path: string; text: string }[]>) => {
    setBusy(true);
    try {
      const files = await get();
      if (!files.length) {
        toast('No .md, .txt or .csv files were found there.', { kind: 'error' });
        return;
      }
      setPlan(buildImportPlan(files));
    } catch (e) {
      reportError(e, 'Could not read those files');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bundle-import" ref={ref}>
      <h3>Import your own files</h3>
      <p>
        Bring in an existing book: chapters as text or Markdown files, and characters, places, your story board, timeline and plot threads from
        spreadsheets. You’ll see everything before it’s added.
      </p>
      <div className="row gap wrap">
        <label className="button primary">
          Choose a folder…
          <input
            type="file"
            hidden
            multiple
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(e) => {
              // Copy before resetting the input: resetting empties the live FileList.
              const list = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (list.length) void load(() => filesFromPicker(list));
            }}
          />
        </label>
        <label className="button">
          Choose a .zip or files…
          <input
            type="file"
            hidden
            multiple
            accept=".zip,.md,.markdown,.txt,.csv,.tsv"
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (!list.length) return;
              void load(async () => {
                const zips = list.filter((f) => f.name.toLowerCase().endsWith('.zip'));
                const out = [];
                for (const z of zips) {
                  if (z.size > 200 * 1024 * 1024) throw new Error('That zip is larger than 200 MB.');
                  out.push(...filesFromZip(new Uint8Array(await z.arrayBuffer())));
                }
                out.push(...(await filesFromPicker(list.filter((f) => !zips.includes(f)))));
                return out;
              });
            }}
          />
        </label>
        <button className="link" onClick={() => setHelp(true)}>
          How to lay out your files
        </button>
        <button className="link" onClick={async () => void (await saveFile(await starterTemplateZip(), 'AuthorDesk import template.zip', 'application/zip'))}>
          Download a starter template
        </button>
      </div>
      {busy && <p className="muted small">Reading files…</p>}
      {help && <LayoutHelp onClose={() => setHelp(false)} />}
      {plan && <PreviewModal projectId={projectId} plan={plan} onClose={() => setPlan(null)} />}
    </div>
  );
}

function LayoutHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to lay out your files" onClose={onClose} wide>
      <p>Put everything in one folder (or zip it). Every file is optional — include only what you have.</p>
      <pre className="layout-tree">{`My Book/
├── chapters/                 one file per chapter, in name order
│   ├── 01 - The Lamp.md      "# Title" line = chapter title
│   └── 02 - Below.txt        "## Heading" = start of a new scene
├── characters.csv            spreadsheet: one row per character
├── characters/               …or one file per character
│   └── Elsie Marr.md         "Role: Minor" lines, then notes
├── locations.csv             one row per place (or locations/ folder)
├── world.csv                 anything else, with a Type column
├── board.csv                 story board cards (Column = which column)
├── timeline.csv              events, with an optional Order number
├── plot-threads.csv          subplots
└── notes/                    research notes, one file each`}</pre>
      <ul className="small">
        <li>
          <strong>Spreadsheets:</strong> save from Excel, Google Sheets or Numbers as <em>CSV</em>. The first row holds the column names (any order, any
          capitalisation). Only <em>Name</em> (or <em>Title</em>) is required. Columns AuthorDesk doesn’t know become your own fields.
        </li>
        <li>
          <strong>Several values in one cell</strong> (nicknames, characters, threads): separate them with semicolons — <code>Mara; the keeper’s girl</code>.
        </li>
        <li>
          <strong>Links happen by name:</strong> write a character’s or place’s name (or nickname) in the board and timeline sheets, and a chapter’s title
          in a Chapter column.
        </li>
        <li>
          <strong>Word documents:</strong> in Word choose <em>Save As → Plain Text</em>; in Google Docs choose <em>File → Download → Markdown</em>.
        </li>
      </ul>
      <p className="small">
        The full guide with every column name is in <code>IMPORTING.md</code> in the AuthorDesk folder. The starter template contains a filled-in example of
        each file.
      </p>
    </Modal>
  );
}

function PreviewModal({ projectId, plan, onClose }: { projectId: string; plan: ImportPlan; onClose: () => void }) {
  const books = useBooks(projectId);
  const [bookId, setBookId] = useState('');
  const [dups, setDups] = useState<'skip' | 'add'>('skip');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BundleReport | null>(null);
  const book = books.find((b) => b.id === bookId) ?? books[0];
  const refCounts = new Map<string, number>();
  for (const r of plan.refs) refCounts.set(r.type, (refCounts.get(r.type) ?? 0) + 1);
  const scenes = plan.chapters.reduce((n, c) => n + c.scenes.length, 0);
  const words = plan.chapters.reduce((n, c) => n + c.scenes.reduce((m, s) => m + s.words, 0), 0);
  const nothing = !plan.chapters.length && !plan.refs.length && !plan.cards.length && !plan.events.length && !plan.threads.length && !plan.notes.length;

  if (report) {
    return (
      <Modal title="Import finished" onClose={onClose}>
        <ul>
          {report.chapters > 0 && (
            <li>
              {n(report.chapters, 'chapter')} ({n(report.scenes, 'scene')}, {n(report.words, 'word')})
            </li>
          )}
          {report.refs > 0 && <li>{n(report.refs, 'character, place or other entry', 'characters, places and other entries')}</li>}
          {report.cards > 0 && <li>{n(report.cards, 'board card')}{report.lanesCreated.length ? ` (new columns: ${report.lanesCreated.join(', ')})` : ''}</li>}
          {report.events > 0 && <li>{n(report.events, 'timeline event')}</li>}
          {report.threads > 0 && <li>{n(report.threads, 'plot thread')}</li>}
          {report.notes > 0 && <li>{n(report.notes, 'note')}</li>}
        </ul>
        {report.refsSkipped.length > 0 && <p className="small">Already had (not imported again): {report.refsSkipped.join(', ')}.</p>}
        {report.unmatched.length > 0 && (
          <div className="banner info small">
            <div>
              These names didn’t match anything, so they weren’t linked (check the spelling, or add them and link by hand):
              <br />
              {report.unmatched.join(' · ')}
            </div>
          </div>
        )}
        <div className="dialog-actions">
          <button onClick={() => navigate(projectId, 'refs')}>See characters & world</button>
          <button className="primary" onClick={() => navigate(projectId, 'write')}>
            Start writing
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Ready to import" onClose={onClose} wide>
      {nothing ? (
        <p>
          Nothing in those files matched the import layout. Check the file and folder names in <em>How to lay out your files</em>.
        </p>
      ) : (
        <>
          <div className="import-summary">
            {plan.chapters.length > 0 && (
              <section>
                <h4>
                  {n(plan.chapters.length, 'chapter')} · {n(scenes, 'scene')} · {n(words, 'word')}
                </h4>
                <ol className="small scroll-list">
                  {plan.chapters.map((c, i) => (
                    <li key={i}>
                      {c.title}
                      {c.scenes.length > 1 && <span className="muted"> — {c.scenes.length} scenes</span>}
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {plan.refs.length > 0 && (
              <section>
                <h4>{n(plan.refs.length, 'character & world entry', 'characters & world entries')}</h4>
                <p className="small">
                  {[...refCounts].map(([t, c]) => `${c} × ${REFERENCE_TYPE_LABELS[t as keyof typeof REFERENCE_TYPE_LABELS]}`).join(' · ')}
                </p>
                <p className="small muted">{plan.refs.slice(0, 12).map((r) => r.name).join(', ')}{plan.refs.length > 12 ? '…' : ''}</p>
              </section>
            )}
            {(plan.cards.length > 0 || plan.events.length > 0 || plan.threads.length > 0 || plan.notes.length > 0) && (
              <section>
                <h4>Planning</h4>
                <p className="small">
                  {[
                    plan.cards.length && n(plan.cards.length, 'board card'),
                    plan.events.length && n(plan.events.length, 'timeline event'),
                    plan.threads.length && n(plan.threads.length, 'plot thread'),
                    plan.notes.length && n(plan.notes.length, 'note'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </section>
            )}
          </div>
          {plan.warnings.length > 0 && (
            <details className="banner info small">
              <summary>
                {plan.warnings.length} thing{plan.warnings.length === 1 ? '' : 's'} to know (the rest will still be imported)
              </summary>
              <ul>
                {plan.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          {books.length > 1 && (
            <label className="field inline">
              <span>Add to book</span>
              <select value={book?.id} onChange={(e) => setBookId(e.target.value)}>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          {plan.refs.length > 0 && (
            <fieldset className="field">
              <legend>If a character or place with the same name already exists</legend>
              <label className="radio">
                <input type="radio" checked={dups === 'skip'} onChange={() => setDups('skip')} /> Keep the one I have (recommended)
              </label>
              <label className="radio">
                <input type="radio" checked={dups === 'add'} onChange={() => setDups('add')} /> Add the imported one as well
              </label>
            </fieldset>
          )}
          <p className="small muted">Chapters are added after your existing chapters. Nothing you already have is changed or removed.</p>
        </>
      )}
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        {!nothing && (
          <button
            className="primary"
            disabled={busy || !book}
            onClick={async () => {
              setBusy(true);
              try {
                await flushAllEdits();
                setReport(await applyImportPlan(projectId, book!.id, plan, { duplicates: dups }));
              } catch (e) {
                reportError(e, 'Import failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        )}
      </div>
    </Modal>
  );
}
