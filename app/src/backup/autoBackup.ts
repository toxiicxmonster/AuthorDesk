import { db } from '../storage/db';
import { buildArchive } from '../importExport/archive';
import { lastChangeAt } from './lastChange';
import { updateSettings } from '../storage/settings';

/**
 * Automatic backups: after the author has been writing, the app builds a fresh archive of the book and hands it to
 * the AuthorDesk desktop app, which keeps a rolling set on disk outside the app's storage (and prunes old ones).
 * Nothing happens when not running under the desktop app (e.g. the dev server).
 */

export interface BackupStatus {
  enabled: boolean;
  folder: string;
  /** Keyed by the first 8 characters of the project id. */
  books: Record<string, { last: string; count: number; bytes: number; title?: string }>;
}

/** Back up once writing has paused this long… */
export const QUIET_MS = 2 * 60_000;
/** …or at least this often while the author keeps writing… */
export const MAX_WAIT_MS = 60 * 60_000;
/** …but never more often than this for one book. */
export const MIN_GAP_MS = 5 * 60_000;

export const shortId = (projectId: string) => projectId.replace(/[^A-Za-z0-9-]/g, '').slice(0, 8);

/** Whether a book needs backing up now. `lastBackup` 0 = never. */
export function backupDue(now: number, lastBackup: number, lastChange: number): boolean {
  if (!lastBackup) return true;
  if (lastChange <= lastBackup || now - lastBackup < MIN_GAP_MS) return false;
  return now - lastChange >= QUIET_MS || now - lastBackup >= MAX_WAIT_MS;
}

const call = async (path: string, init?: RequestInit): Promise<BackupStatus | null> => {
  try {
    const res = await fetch(path, { cache: 'no-store', ...init });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    return (await res.json()) as BackupStatus;
  } catch {
    return null;
  }
};

export const fetchBackupStatus = () => call('/backup/status');
export const setBackupsEnabled = (on: boolean) => call(`/backup/settings?enabled=${on ? 1 : 0}`, { method: 'POST' });
export const chooseBackupFolder = () => call('/backup/choose', { method: 'POST' });
export const openBackupFolder = (projectId?: string) => call(`/backup/open${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`, { method: 'POST' });

/** Builds the book's archive and saves it through the desktop app. Returns the new status, or throws with a reason. */
export async function backUpNow(projectId: string): Promise<BackupStatus> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('That book no longer exists.');
  const { bytes } = await buildArchive(projectId);
  const res = await fetch(`/backup/save?project=${encodeURIComponent(projectId)}&title=${encodeURIComponent(project.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes as BodyInit,
  });
  if (!res.ok) {
    let msg = `The backup couldn't be saved (HTTP ${res.status}).`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  // An automatic backup counts as a backup: no need for the reminder to nag.
  await updateSettings({ lastBackupAt: new Date().toISOString() });
  return (await res.json()) as BackupStatus;
}

let started = false;
let running = false;
const lastSaved = new Map<string, number>();

/** Checks every 30 seconds whether any book needs backing up. Safe to call more than once. */
export function startAutoBackup() {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.setTimeout(() => void tick(), 15_000);
  window.setInterval(() => void tick(), 30_000);
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const status = await fetchBackupStatus();
    if (!status?.enabled) return;
    const now = Date.now();
    for (const p of await db.projects.toArray()) {
      if (p.archivedAt) continue;
      const fromDisk = status.books[shortId(p.id)]?.last;
      const last = Math.max(lastSaved.get(p.id) ?? 0, fromDisk ? new Date(fromDisk).getTime() : 0);
      if (!backupDue(now, last, lastChangeAt(p.id))) continue;
      if (!last && !(await db.scenes.where('projectId').equals(p.id).count())) continue; // nothing written yet
      try {
        await backUpNow(p.id);
        lastSaved.set(p.id, Date.now());
      } catch (e) {
        console.warn('Automatic backup failed', e);
        lastSaved.set(p.id, now); // don't retry every 30 seconds; try again after the usual gap
      }
    }
  } finally {
    running = false;
  }
}
