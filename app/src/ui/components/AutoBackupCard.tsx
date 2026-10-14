import { useEffect, useState } from 'react';
import { backUpNow, chooseBackupFolder, fetchBackupStatus, openBackupFolder, setBackupsEnabled, shortId, type BackupStatus } from '../../backup/autoBackup';
import { flushAllEdits } from '../../editor/EditorContext';
import { reportError, toast } from '../store';
import { relativeTime } from './common';

const size = (bytes: number) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Backup page → Automatic backups: on/off, where they go, and when this book was last saved there. */
export function AutoBackupCard({ projectId }: { projectId: string }) {
  const [st, setSt] = useState<BackupStatus | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const s = await fetchBackupStatus();
      if (alive) setSt(s);
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (st === undefined) return null;
  if (st === null) {
    return (
      <section className="card">
        <h2>Automatic backups</h2>
        <p className="muted small">Automatic backups run when AuthorDesk is started from AuthorDesk.exe. Use “Save backup” below meanwhile.</p>
      </section>
    );
  }

  const mine = st.books[shortId(projectId)];
  const update = (next: BackupStatus | null) => next && setSt(next);

  return (
    <section className="card">
      <h2>Automatic backups</h2>
      <label className="check">
        <input type="checkbox" checked={st.enabled} onChange={async (e) => update(await setBackupsEnabled(e.target.checked))} /> Keep automatic backups of my books on
        this PC
      </label>
      <p className="small">
        A fresh copy is saved a couple of minutes after you stop writing (and at least hourly while you keep going). AuthorDesk keeps every copy from the last day,
        one a day for a month, then one a week, and always your newest five.
      </p>
      <p className="small">
        Saved in <code className="path">{st.folder}</code>
        <br />
        This book: {mine ? `last backup ${relativeTime(new Date(mine.last).toISOString())} · ${mine.count} kept · ${size(mine.bytes)}` : 'no automatic backup yet'}
      </p>
      <div className="row gap wrap">
        <button
          className="primary"
          disabled={busy || !st.enabled}
          onClick={async () => {
            setBusy(true);
            try {
              await flushAllEdits();
              setSt(await backUpNow(projectId));
              toast('Backed up.');
            } catch (e) {
              reportError(e, 'Backup failed');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Backing up…' : 'Back up now'}
        </button>
        <button onClick={async () => update(await chooseBackupFolder())} title="A OneDrive, Google Drive or Dropbox folder also keeps a copy off this PC">
          Change folder…
        </button>
        <button onClick={() => void openBackupFolder(projectId)}>Open folder</button>
      </div>
      <p className="muted small">
        To restore, use <strong>Restore a backup</strong> in Settings with any file from that folder.
      </p>
    </section>
  );
}
