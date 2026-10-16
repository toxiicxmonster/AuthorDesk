import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncStatus } from '../../sync/useSyncStatus';
import { deleteCloudCopy, signIn, signOut, syncNow, useSyncUi } from '../../sync/controller';
import { resolveConflict } from '../../sync/engine';
import { db, table, type SyncConflict } from '../../storage/db';
import { getDeviceId } from '../../storage/device';
import { SCHEMA_VERSION, TABLE_NAMES, type TableName } from '../../domain/schema';
import { Modal, relativeTime } from './common';
import { confirmDialog, reportError, toast } from '../store';

export function SyncPanel({ projectId }: { projectId: string | null }) {
  const sync = useSyncStatus(projectId);
  const ui = useSyncUi();
  const conflicts = useLiveQuery(() => (projectId ? db.conflicts.where('projectId').equals(projectId).toArray() : db.conflicts.toArray()), [projectId]) ?? [];
  const [resolving, setResolving] = useState<SyncConflict | null>(null);

  return (
    <section className="card">
      <h2>Sync between devices</h2>
      <p>
        <strong>Status: {sync.label}.</strong> {sync.detail}
      </p>
      {ui.server === 'unavailable' || ui.server === 'unknown' ? (
        <div className="small">
          <p>
            Cross-device sync uses your own private AuthorDesk sync server, so your manuscript is never on a public site. This copy of the app was not opened
            from one. To sync your PC and phone:
          </p>
          <ol>
            <li>Run the sync server somewhere both devices can reach over HTTPS (see <code>docs/sync-server.md</code>).</li>
            <li>Open the app from that address on your phone and install it; on the computer, point AuthorDesk at it (one line in <code>sync-server.txt</code>).</li>
            <li>Sign in on both. Existing work here can be moved with a backup or will upload on first sync.</li>
          </ol>
          <p>Until then, move work between devices with backups.</p>
        </div>
      ) : ui.server === 'signed-out' ? (
        <SignInForm />
      ) : (
        <>
          <div className="row gap wrap">
            <button className="primary" disabled={ui.running} onClick={() => void syncNow()}>
              {ui.running ? 'Syncing…' : 'Sync now'}
            </button>
            <span className="small muted">
              Signed in as <strong>{ui.username}</strong> · last synced {relativeTime(ui.lastSyncedAt)}
              {ui.lastReport && ` · ↓${ui.lastReport.pulled} ↑${ui.lastReport.pushed}${ui.lastReport.merged ? ` · ${ui.lastReport.merged} merged` : ''}`}
            </span>
          </div>
          {ui.error && <p className="warn-text small">⚠ {ui.error}</p>}
          {conflicts.length > 0 && (
            <div className="banner warn">
              <div>
                <strong>Resolve conflicts.</strong> The same item was changed on two devices. Nothing was lost: this device’s version is shown in the app, and the
                other version is kept here (and in History for scenes).
                <ul>
                  {conflicts.map((c) => (
                    <li key={c.id}>
                      {c.table === 'scenes' ? 'Scene' : c.table} “{c.title}” · {relativeTime(c.createdAt)}{' '}
                      <button className="small" onClick={() => setResolving(c)}>
                        Compare & resolve…
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <div className="row gap wrap">
            <button onClick={() => void signOut().catch((e) => reportError(e, 'Sign out failed'))}>Sign out</button>
            <button
              onClick={async () => {
                if (await confirmDialog('Sign out everywhere?', 'Every device signed in to this account will need to sign in again.', { confirmLabel: 'Sign out everywhere' }))
                  await signOut(true).catch((e) => reportError(e, 'Sign out failed'));
              }}
            >
              Sign out on all devices
            </button>
            {projectId && <button
              className="danger-text"
              onClick={async () => {
                if (!projectId) return;
                const ok = await confirmDialog(
                  'Delete this project’s cloud copy?',
                  'The copy on the sync server is removed. This device keeps its copy, and other devices keep theirs until you delete them. Backups you exported are not affected. If this device syncs again later, the project will upload again.',
                  { confirmLabel: 'Delete cloud copy', danger: true },
                );
                if (!ok) return;
                try {
                  const r = await deleteCloudCopy(projectId);
                  toast(`Removed ${r.deleted} records from the server.`);
                } catch (e) {
                  reportError(e, 'Delete failed');
                }
              }}
            >
              Delete cloud copy…
            </button>}
          </div>
        </>
      )}
      <Diagnostics projectId={projectId} />
      {resolving && <ConflictModal c={resolving} onClose={() => setResolving(null)} />}
    </section>
  );
}

function SignInForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="signin"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await signIn(username.trim(), password);
          setPassword('');
          toast('Signed in. Syncing…');
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="small">Sign in to this AuthorDesk sync server. Your session is kept in a secure cookie that scripts cannot read.</p>
      <label className="field">
        <span>Username</span>
        <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </label>
      <label className="field">
        <span>Passphrase</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <p className="warn-text small" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in & sync'}
      </button>
    </form>
  );
}

function ConflictModal({ c, onClose }: { c: SyncConflict; onClose: () => void }) {
  const mine = useLiveQuery(() => table(c.table as TableName).get(c.recordId as never) as Promise<Record<string, unknown> | undefined>, [c.id]);
  const theirs = c.other;
  const fields = mine
    ? [...new Set([...Object.keys(mine), ...Object.keys(theirs)])].filter(
        (k) => !['rev', 'updatedAt', 'createdAt', 'content', 'wordCount', 'referenceIds'].includes(k) && JSON.stringify(mine[k]) !== JSON.stringify(theirs[k]),
      )
    : [];
  const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  const act = async (choice: 'mine' | 'theirs' | 'both') => {
    await resolveConflict(c.id, choice);
    onClose();
    toast(choice === 'mine' ? 'Kept this device’s version' : choice === 'theirs' ? 'Using the other device’s version (yours is in History)' : 'Kept both versions');
    void syncNow();
  };
  return (
    <Modal title={`Conflict: ${c.title}`} onClose={onClose} wide>
      {!mine ? (
        <p className="muted">This item no longer exists on this device.</p>
      ) : (
        <div className="compare">
          {fields.map((k) => (
            <div key={k} className="compare-row">
              <h4>{k === 'plainText' ? 'Text' : k}</h4>
              <div className="compare-cols">
                <div>
                  <div className="muted small">This device</div>
                  <div className="compare-text">{show(mine[k])}</div>
                </div>
                <div>
                  <div className="muted small">Other device</div>
                  <div className="compare-text">{show(theirs[k])}</div>
                </div>
              </div>
            </div>
          ))}
          {fields.length === 0 && <p className="muted">The versions are now identical.</p>}
        </div>
      )}
      <div className="dialog-actions">
        <button onClick={() => act('mine')}>Keep this device’s</button>
        <button onClick={() => act('theirs')}>Use other device’s</button>
        {c.table === 'scenes' && (
          <button className="primary" onClick={() => act('both')}>
            Keep both (as two scenes)
          </button>
        )}
      </div>
    </Modal>
  );
}

function Diagnostics({ projectId }: { projectId: string | null }) {
  const sync = useSyncStatus(projectId);
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null);
  const counts = useLiveQuery(async () => {
    const out: Record<string, number> = {};
    for (const t of TABLE_NAMES) out[t] = !projectId ? await db.table(t).count() : t === 'projects' ? 1 : await db.table(t).where('projectId').equals(projectId).count();
    return out;
  }, [projectId]);
  useEffect(() => {
    void (async () => {
      try {
        const e = await navigator.storage?.estimate?.();
        const persisted = await navigator.storage?.persisted?.();
        setEstimate({ usage: e?.usage, quota: e?.quota, persisted });
      } catch {
        setEstimate({});
      }
    })();
  }, []);
  const mb = (n?: number) => (n === undefined ? '?' : `${(n / 1024 / 1024).toFixed(1)} MB`);
  return (
    <details>
      <summary>Diagnostics (no manuscript text)</summary>
      <dl className="diag">
        <dt>Device id</dt>
        <dd>{getDeviceId().slice(0, 8)}…</dd>
        <dt>Data schema</dt>
        <dd>v{SCHEMA_VERSION}</dd>
        <dt>Sync state</dt>
        <dd>{sync.state}</dd>
        <dt>Changes waiting to sync</dt>
        <dd>{sync.pendingChanges}</dd>
        <dt>Unresolved conflicts</dt>
        <dd>{sync.conflicts}</dd>
        <dt>Last successful sync</dt>
        <dd>{sync.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleString() : 'never'}</dd>
        <dt>Storage used (all projects)</dt>
        <dd>
          {mb(estimate?.usage)} of {mb(estimate?.quota)}
        </dd>
        <dt>Protected from browser cleanup</dt>
        <dd>{estimate?.persisted ? 'Yes' : 'No — the browser may clear data under storage pressure; keep backups'}</dd>
        <dt>Records</dt>
        <dd>{counts ? Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ') : '…'}</dd>
        <dt>Online</dt>
        <dd>{navigator.onLine ? 'Yes' : 'No'}</dd>
      </dl>
    </details>
  );
}
