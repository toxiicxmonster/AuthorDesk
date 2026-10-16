import { useEffect, useState } from 'react';
import { applyImport, parseArchive } from '../../importExport/archive';
import { fetchBackupStatus, type BackupStatus } from '../../backup/autoBackup';
import { reportError, toast } from '../store';

/**
 * On the welcome screen of an empty app: the books in AuthorDesk's automatic backups folder, with one button that
 * restores the newest backup of each. Mainly for moving to the desktop app when the earlier version's storage
 * couldn't be copied over, or onto a new computer. Shown only when there are backups to restore.
 */
export function BackupRecovery() {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetchBackupStatus().then(setStatus);
  }, []);
  const books = Object.entries(status?.books ?? {});
  if (!books.length) return null;

  const restore = async () => {
    setBusy(true);
    let done = 0;
    try {
      for (const [id] of books) {
        const res = await fetch(`/backup/file?project=${encodeURIComponent(id)}`, { method: 'POST', cache: 'no-store' });
        if (!res.ok) throw new Error(`Couldn’t read the backup of “${status!.books[id].title ?? id}”.`);
        await applyImport(await parseArchive(new Uint8Array(await res.arrayBuffer())), 'merge');
        done++;
      }
      toast(`Restored ${done} book${done === 1 ? '' : 's'} from your automatic backups.`);
    } catch (e) {
      reportError(e, done ? `Restored ${done}, then stopped` : 'Couldn’t restore the backups');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card backup-recovery">
      <h2>Your books from automatic backups</h2>
      <p className="small">
        AuthorDesk found {books.length === 1 ? 'a book' : `${books.length} books`} in your backups folder ({status!.folder}). Restore the newest backup of{' '}
        {books.length === 1 ? 'it' : 'each'} to carry on where you left off.
      </p>
      <ul className="small">
        {books.map(([id, b]) => (
          <li key={id}>
            <strong>{b.title || id}</strong> <span className="muted">· backed up {new Date(b.last).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </li>
        ))}
      </ul>
      <button className="primary" disabled={busy} onClick={() => void restore()}>
        {busy ? 'Restoring…' : books.length === 1 ? 'Restore this book' : `Restore all ${books.length} books`}
      </button>
    </section>
  );
}
