import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';
import type { SyncStatus } from './types';
import { useSyncUi } from './controller';
import { useUi } from '../ui/store';

/** Current sync status, reported honestly: never "synced" unless a sync actually completed. */
export function useSyncStatus(projectId: string | null): SyncStatus {
  const pending = useLiveQuery(async () => (projectId ? db.changes.where('projectId').equals(projectId).count() : db.changes.count()), [projectId]) ?? 0;
  const conflicts = useLiveQuery(async () => (projectId ? db.conflicts.where('projectId').equals(projectId).count() : db.conflicts.count()), [projectId]) ?? 0;
  const s = useSyncUi();
  const online = useUi((u) => u.online);
  const base = { lastSyncedAt: s.lastSyncedAt, pendingChanges: pending, conflicts, provider: s.username ? `Sync server (${s.username})` : null };
  if (s.server === 'unavailable' || s.server === 'unknown') {
    return {
      ...base,
      state: 'local',
      label: 'Local only',
      detail: 'Saved on this device only. Cross-device sync needs the AuthorDesk sync server (see Backup & Sync).',
    };
  }
  if (s.server === 'signed-out') return { ...base, state: 'local', label: 'Not signed in', detail: 'Sign in under Backup & Sync to sync between devices.' };
  if (!online) return { ...base, state: 'offline', label: 'Offline', detail: `Changes are saved here and will sync when you reconnect (${pending} waiting).` };
  if (conflicts) return { ...base, state: 'conflict', label: `${conflicts} conflict${conflicts === 1 ? '' : 's'}`, detail: 'Both versions were kept. Resolve them under Backup & Sync.' };
  if (s.error) return { ...base, state: 'error', label: 'Sync error', detail: s.error };
  if (s.running) return { ...base, state: 'syncing', label: 'Syncing…', detail: 'Syncing with the server' };
  if (pending) return { ...base, state: 'syncing', label: `${pending} to sync`, detail: 'Local changes are waiting to upload.' };
  return { ...base, state: 'synced', label: 'Synced', detail: `Last synced ${s.lastSyncedAt ? new Date(s.lastSyncedAt).toLocaleString() : 'just now'}` };
}
