import { useState } from 'react';
import { useBooks, useProject } from '../data';
import { buildArchive, exportJson, ARCHIVE_EXTENSION } from '../../importExport/archive';
import { exportDocx, exportMarkdownZip, exportOutlineDocx, exportReferencesCsv, exportText } from '../../importExport/exporters';
import { saveFile, stamp, fileSafe } from '../../importExport/download';
import { BundleImportCard } from '../components/BundleImport';
import { KdpExportDialog } from '../components/KdpExport';
import { ExtraPagesPicker, useExtraPagesData, type ExtraPagesChoice } from '../components/BookPages';
import { NO_EXTRA_PAGES, resolveExtraPages } from '../../domain/bookPages';
import * as drive from '../../importExport/googleDrive';
import { useArchiveImport } from '../components/ImportPanel';
import { updateSettings, useSettings } from '../../storage/settings';
import { flushAllEdits } from '../../editor/EditorContext';
import { reportError, toast, useUi } from '../store';
import { relativeTime } from '../components/common';
import { SyncPanel } from '../components/SyncPanel';
import { AutoBackupCard } from '../components/AutoBackupCard';

export function DataPage({ projectId, autoImportHelp = false, autoKdp = false }: { projectId: string; autoImportHelp?: boolean; autoKdp?: boolean }) {
  const project = useProject(projectId);
  const books = useBooks(projectId);
  const settings = useSettings();
  const [bookId, setBookId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [withHistory, setWithHistory] = useState(true);
  const importer = useArchiveImport();
  const [kdpOpen, setKdpOpen] = useState(autoKdp);
  const book = books.find((b) => b.id === bookId) ?? books[0];
  const [pageChoice, setPageChoice] = useState<ExtraPagesChoice>({});
  const pageData = useExtraPagesData(projectId);
  /** Dedication / About the Author for a book: the chosen pages for the selected book, automatic for the others. */
  const pagesFor = (id: string) =>
    pageData ? resolveExtraPages(id, projectId, pageData.projects, pageData.books, id === book?.id ? pageChoice : {}) : NO_EXTRA_PAGES;
  const name = fileSafe(project?.name ?? 'project');

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await flushAllEdits();
      await fn();
    } catch (e) {
      reportError(e, `${label} failed`);
    } finally {
      setBusy(null);
    }
  };

  const exportArchive = () =>
    run('Backup', async () => {
      const { bytes, manifest } = await buildArchive(projectId, { includeSnapshots: withHistory });
      const r = await saveFile(bytes, `${name}_${stamp()}${ARCHIVE_EXTENSION}`, 'application/zip');
      if (r === 'saved') {
        await updateSettings({ lastBackupAt: manifest.exportedAt });
        toast('Backup saved. Keep it somewhere safe (another drive or cloud folder).');
      }
    });

  return (
    <div className="page narrow data-page">
      <h1>Backup, export & sync</h1>
      <AutoBackupCard projectId={projectId} />
      <section className="card">
        <h2>Back up this book</h2>
        <p>
          A complete archive includes every book, chapter, scene, reference, board card, timeline event, plot thread, note, your dictionary and settings. Last
          backup: <strong>{relativeTime(settings.lastBackupAt)}</strong>.
        </p>
        <label className="check">
          <input type="checkbox" checked={withHistory} onChange={(e) => setWithHistory(e.target.checked)} /> Include revision history (snapshots)
        </label>
        <div className="row gap wrap">
          <button className="primary" disabled={!!busy} onClick={exportArchive}>
            {busy === 'Backup' ? 'Saving…' : `Save backup (${ARCHIVE_EXTENSION})`}
          </button>
        </div>
        <label className="field inline">
          <span>Remind me to back up every</span>
          <input type="number" min={1} max={90} value={settings.backupReminderDays} onChange={(e) => void updateSettings({ backupReminderDays: Math.max(1, parseInt(e.target.value, 10) || 7) })} style={{ width: '4em' }} />
          <span>days</span>
        </label>
        <p className="muted small">Tip: you can save straight into a Google Drive, OneDrive or Dropbox folder on this computer.</p>
      </section>

      <section className="card publish-card">
        <h2>Publish</h2>
        <p>
          Get a store-ready manuscript for <strong>Amazon KDP</strong>: a Kindle eBook (EPUB or Word) or a print-ready paperback/hardcover interior, with a
          title page, copyright page, proper chapter breaks and KDP’s margin rules — plus a checklist before you upload.
        </p>
        <button className="primary" disabled={!book} onClick={() => setKdpOpen(true)}>
          Publish on Amazon KDP…
        </button>
        {kdpOpen && book && <KdpExportDialog projectId={projectId} bookId={book.id} onClose={() => setKdpOpen(false)} />}
      </section>

      <section className="card">
        <h2>Export for reading or sharing</h2>
        {books.length > 1 && (
          <label className="field inline">
            <span>Book</span>
            <select
              value={book?.id}
              onChange={(e) => {
                setBookId(e.target.value);
                setPageChoice({});
              }}
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {book && <ExtraPagesPicker projectId={projectId} bookId={book.id} value={pageChoice} onChange={setPageChoice} />}
        <div className="row gap wrap">
          <button disabled={!!busy || !book} onClick={() => run('DOCX export', async () => void (await saveFile(await exportDocx(projectId, book!.id, pagesFor(book!.id)), `${fileSafe(book!.title)}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')))}>
            Word (.docx)
          </button>
          <button disabled={!!busy || !book} onClick={() => run('Text export', async () => void (await saveFile(await exportText(projectId, book!.id, pagesFor(book!.id)), `${fileSafe(book!.title)}.txt`, 'text/plain')))}>
            Plain text (.txt)
          </button>
          <button
            disabled={!!busy || !book}
            title="Chapter and scene summaries, point of view, place, time and your plan points (ticked ones marked), to read or print"
            onClick={() => run('Outline export', async () => void (await saveFile(await exportOutlineDocx(projectId, book!.id), `${fileSafe(book!.title)} - outline.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')))}
          >
            Outline (.docx)
          </button>
          <button disabled={!!busy} onClick={() => run('Markdown export', async () => void (await saveFile(await exportMarkdownZip(projectId, pagesFor), `${name}_markdown.zip`, 'application/zip')))}>
            Markdown folder (.zip)
          </button>
          <button disabled={!!busy} onClick={() => run('JSON export', async () => void (await saveFile(await exportJson(projectId), `${name}_${stamp()}.json`, 'application/json')))}>
            Data (.json)
          </button>
          <button disabled={!!busy} onClick={() => run('CSV export', async () => void (await saveFile(await exportReferencesCsv(projectId), `${name}_references.csv`, 'text/csv')))}>
            References (.csv)
          </button>
        </div>
        {busy && busy !== 'Backup' && <p className="muted small" aria-live="polite">{busy}…</p>}
      </section>

      <section className="card" id="import">
        <h2>Import</h2>
        <BundleImportCard projectId={projectId} autoOpenHelp={autoImportHelp} />
        <h3>Restore an AuthorDesk backup</h3>
        <p>Restore or merge a <code>{ARCHIVE_EXTENSION}</code> backup. You’ll see exactly what will change before anything is imported.</p>
        <label className="button">
          Choose backup file…
          <input type="file" accept={`${ARCHIVE_EXTENSION},.zip`} hidden onChange={(e) => e.target.files?.[0] && void importer.loadFile(e.target.files[0]).finally(() => (e.target.value = ''))} />
        </label>
      </section>

      <DriveSection projectId={projectId} name={name} onRestore={importer.loadBytes} />
      <SyncPanel projectId={projectId} />

      {importer.modal}
    </div>
  );
}

function DriveSection({ projectId, name, onRestore }: { projectId: string; name: string; onRestore: (b: Uint8Array) => Promise<void> }) {
  const [connected, setConnected] = useState(drive.isDriveConnected());
  const [files, setFiles] = useState<drive.DriveFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const online = useUi((s) => s.online);
  const configured = drive.isDriveConfigured();

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      reportError(e, label);
      setConnected(drive.isDriveConnected());
    } finally {
      setBusy(null);
    }
  };
  const refresh = () => act('Listing Drive backups', async () => setFiles(await drive.listBackups(await drive.ensureFolder())));

  return (
    <section className="card">
      <h2>Google Drive</h2>
      {!configured ? (
        <>
          <p>
            <strong>Not set up yet.</strong> Drive backup needs a free Google Cloud OAuth client ID (a one-time setup; no password is ever entered into
            AuthorDesk).{' '}
            <a href="https://github.com/toxiicxmonster/AuthorDesk/blob/main/docs/google-drive-setup.md" target="_blank" rel="noreferrer">
              How to set it up
            </a>
            .
          </p>
          <p className="muted small">Meanwhile, “Save backup” above can write directly into a Google Drive for Desktop folder.</p>
        </>
      ) : !online ? (
        <p>You’re offline. Drive is unavailable until you reconnect; local backups still work.</p>
      ) : !connected ? (
        <>
          <p>
            AuthorDesk asks only for access to files it creates (<em>drive.file</em> scope). It cannot see the rest of your Drive. Backups go into a folder called “
            {drive.DEFAULT_FOLDER}”.
          </p>
          <button className="primary" disabled={!!busy} onClick={() => act('Connecting to Google Drive', async () => { await drive.connectDrive(); setConnected(true); await refresh(); })}>
            Connect Google Drive
          </button>
          <p className="muted small">Experimental: verify a backup and restore round-trip after connecting for the first time.</p>
        </>
      ) : (
        <>
          <div className="row gap wrap">
            <button
              className="primary"
              disabled={!!busy}
              onClick={() =>
                act('Backing up to Drive', async () => {
                  await flushAllEdits();
                  const { bytes, manifest } = await buildArchive(projectId);
                  const folder = await drive.ensureFolder();
                  const f = await drive.uploadFile(folder, `${name}_${stamp()}${ARCHIVE_EXTENSION}`, new Blob([bytes as BlobPart], { type: 'application/zip' }));
                  await updateSettings({ lastBackupAt: manifest.exportedAt });
                  toast(`Backed up to Drive as ${f.name}`);
                  await refresh();
                })
              }
            >
              Back up to Drive now
            </button>
            <button disabled={!!busy} onClick={refresh}>
              Refresh list
            </button>
            <button
              disabled={!!busy}
              onClick={() =>
                act('Disconnecting', async () => {
                  await drive.disconnectDrive();
                  setConnected(false);
                  setFiles(null);
                  toast('Disconnected and access revoked.');
                })
              }
            >
              Disconnect
            </button>
          </div>
          {busy && <p className="muted small">{busy}…</p>}
          <h3>Backups in Drive</h3>
          <ul className="plain">
            {files?.map((f) => (
              <li key={f.id}>
                {f.name} <span className="muted small">{new Date(f.modifiedTime).toLocaleString()} · {f.size ? `${Math.round(Number(f.size) / 1024)} KB` : ''}</span>{' '}
                <button className="small" disabled={!!busy} onClick={() => act('Downloading backup', async () => onRestore(await drive.downloadFile(f.id)))}>
                  Restore…
                </button>
              </li>
            ))}
            {files?.length === 0 && <li className="muted">No backups yet.</li>}
          </ul>
          <p className="muted small">
            To revoke access completely, also visit myaccount.google.com → Security → Third-party access. Backups you made stay in your Drive.
          </p>
        </>
      )}
    </section>
  );
}
