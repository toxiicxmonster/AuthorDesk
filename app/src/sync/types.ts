import type { TableName } from '../domain/schema';

/** A versioned record as exchanged with a sync backend. */
export interface SyncRecord {
  table: TableName;
  id: string;
  projectId: string;
  /** Record revision on the device that wrote it. */
  rev: number;
  /** Server-assigned monotonically increasing version; the source of truth for ordering (not device clocks). */
  serverVersion: number;
  deleted: boolean;
  data: Record<string, unknown> | null;
}

export interface PullResult {
  records: SyncRecord[];
  cursor: string;
}

export interface PushResult {
  /** Records the server stored, with their new server versions. */
  accepted: { table: TableName; id: string; serverVersion: number }[];
  /** Records the server refused because its copy changed since our base version. */
  rejected: { table: TableName; id: string; current: SyncRecord }[];
}

/**
 * Pluggable sync backend. Implementations must authenticate server-side (no long-lived tokens in
 * browser storage) and use version-checked writes (`baseVersion`) so nothing is silently overwritten.
 */
export interface SyncProvider {
  id: string;
  label: string;
  isConfigured(): boolean;
  pull(projectId: string, cursor: string | null): Promise<PullResult>;
  push(projectId: string, changes: { record: SyncRecord; baseVersion: number | null }[]): Promise<PushResult>;
}

export type SyncState = 'local' | 'syncing' | 'synced' | 'offline' | 'conflict' | 'error';

export interface SyncStatus {
  state: SyncState;
  label: string;
  detail: string;
  lastSyncedAt: string | null;
  provider: string | null;
  pendingChanges: number;
  conflicts: number;
}
