import { useSyncExternalStore } from 'react';
import { api, httpTransport, syncOnce, SyncHttpError, type SyncReport } from './engine';
import { db } from '../storage/db';
import { flushAllEdits } from '../editor/EditorContext';
import { getDeviceId } from '../storage/device';

export type ServerState = 'unknown' | 'unavailable' | 'signed-out' | 'signed-in';

export interface SyncUiState {
  server: ServerState;
  username: string | null;
  running: boolean;
  lastSyncedAt: string | null;
  lastReport: SyncReport | null;
  error: string | null;
}

let state: SyncUiState = { server: 'unknown', username: null, running: false, lastSyncedAt: null, lastReport: null, error: null };
const listeners = new Set<() => void>();
const set = (p: Partial<SyncUiState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};

export function useSyncUi(): SyncUiState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

/** Ask the origin that served the app whether it has a sync server (it does when hosted by server/index.js). */
export async function detectServer(): Promise<void> {
  try {
    const s = (await api('/api/status')) as { server?: string; signedIn: boolean; username: string | null };
    if (s.server !== 'authordesk-sync') throw new Error('not a sync server');
    set({ server: s.signedIn ? 'signed-in' : 'signed-out', username: s.username });
    const last = (await db.settings.get('sync:lastSyncedAt'))?.value as string | undefined;
    if (last) set({ lastSyncedAt: last });
    if (s.signedIn) startBackgroundSync();
  } catch (e) {
    set({ server: e instanceof SyncHttpError && e.status === 0 && state.server !== 'unknown' ? state.server : 'unavailable' });
  }
}

export async function signIn(username: string, password: string) {
  await api('/api/login', { username, password, device: navigator.userAgent.slice(0, 60) });
  set({ server: 'signed-in', username, error: null });
  startBackgroundSync();
  await syncNow();
}

export async function signOut(everywhere = false) {
  stopBackgroundSync();
  await api('/api/logout', { everywhere });
  set({ server: 'signed-out', username: null });
}

let inflight: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (state.server !== 'signed-in') return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    if (!navigator.onLine) {
      set({ error: null });
      return;
    }
    set({ running: true, error: null });
    try {
      await flushAllEdits();
      const report = await syncOnce(httpTransport);
      const at = new Date().toISOString();
      await db.settings.put({ key: 'sync:lastSyncedAt', value: at });
      set({ lastSyncedAt: at, lastReport: report });
    } catch (e) {
      if (e instanceof SyncHttpError && e.status === 401) set({ server: 'signed-out', username: null, error: 'Signed out by the server. Sign in again.' });
      else set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ running: false });
      inflight = null;
    }
  })();
  return inflight;
}

let timer: number | undefined;
let lastPending = 0;

function startBackgroundSync() {
  if (timer) return;
  const tick = async () => {
    const pending = await db.changes.count();
    // Sync when there are local changes (debounced by the tick) and periodically to receive other devices' work.
    if (pending !== lastPending || pending > 0 || Date.now() - Date.parse(state.lastSyncedAt ?? '1970') > 120_000) void syncNow();
    lastPending = pending;
  };
  timer = window.setInterval(() => void tick(), 15_000);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
}

function stopBackgroundSync() {
  window.clearInterval(timer);
  timer = undefined;
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisible);
}

const onOnline = () => void syncNow();
const onVisible = () => {
  if (document.visibilityState === 'visible') void syncNow();
};

export async function deleteCloudCopy(projectId: string) {
  return (await api('/api/sync/delete-project', { projectId })) as { deleted: number };
}

export { getDeviceId };
