import Dexie, { type EntityTable } from 'dexie';
import type { TableTypes, TableName } from '../domain/schema';

/** Local change log entry; the sync engine reads this to know what to push. Contains no manuscript text. */
export interface ChangeLogEntry {
  seq?: number;
  table: TableName;
  recordId: string;
  projectId: string;
  rev: number;
  op: 'put' | 'delete';
  at: string;
  deviceId: string;
}

/** An author's decision to ignore one specific suggestion occurrence. */
export interface IgnoredSuggestion {
  id: string;
  projectId: string;
  ruleId: string;
  /** Exact flagged text plus context hash, so the ignore survives small edits elsewhere. */
  key: string;
}

/** Last server version and content agreed with the sync server, for three-way merges. */
export interface SyncMeta {
  key: string; // `${table}:${id}`
  serverVersion: number;
  base: Record<string, unknown> | null;
}

/** A prose conflict between devices awaiting the author's decision. Both versions are preserved. */
export interface SyncConflict {
  id: string;
  projectId: string;
  table: string;
  recordId: string;
  title: string;
  /** The other device's version of the record. */
  other: Record<string, unknown>;
  createdAt: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export class AuthorDb extends Dexie {
  projects!: EntityTable<TableTypes['projects'], 'id'>;
  books!: EntityTable<TableTypes['books'], 'id'>;
  parts!: EntityTable<TableTypes['parts'], 'id'>;
  chapters!: EntityTable<TableTypes['chapters'], 'id'>;
  scenes!: EntityTable<TableTypes['scenes'], 'id'>;
  references!: EntityTable<TableTypes['references'], 'id'>;
  plotThreads!: EntityTable<TableTypes['plotThreads'], 'id'>;
  timelineEvents!: EntityTable<TableTypes['timelineEvents'], 'id'>;
  boardLanes!: EntityTable<TableTypes['boardLanes'], 'id'>;
  boardCards!: EntityTable<TableTypes['boardCards'], 'id'>;
  notes!: EntityTable<TableTypes['notes'], 'id'>;
  snapshots!: EntityTable<TableTypes['snapshots'], 'id'>;
  dictionary!: EntityTable<TableTypes['dictionary'], 'id'>;
  revisions!: EntityTable<TableTypes['revisions'], 'id'>;
  maps!: EntityTable<TableTypes['maps'], 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;
  changes!: EntityTable<ChangeLogEntry, 'seq'>;
  ignored!: EntityTable<IgnoredSuggestion, 'id'>;
  syncMeta!: EntityTable<SyncMeta, 'key'>;
  conflicts!: EntityTable<SyncConflict, 'id'>;

  constructor(name = 'authordesk') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt',
      books: 'id, projectId',
      parts: 'id, projectId, bookId',
      chapters: 'id, projectId, bookId',
      scenes: 'id, projectId, chapterId, *referenceIds',
      references: 'id, projectId, type',
      plotThreads: 'id, projectId',
      timelineEvents: 'id, projectId',
      boardLanes: 'id, projectId, bookId',
      boardCards: 'id, projectId, bookId, laneId',
      notes: 'id, projectId',
      snapshots: 'id, projectId, sceneId',
      dictionary: 'id, projectId',
      settings: 'key',
      changes: '++seq, projectId, recordId',
      ignored: 'id, projectId',
    });
    this.version(2).stores({
      syncMeta: 'key',
      conflicts: 'id, projectId, recordId',
    });
    // v0.6: edit passes and maps.
    this.version(3).stores({
      revisions: 'id, projectId, passId, sceneId',
      maps: 'id, projectId, referenceId',
    });
  }
}

export let db = new AuthorDb();

/** Tests swap databases to simulate several devices. */
export function setDbForTests(instance: AuthorDb) {
  db = instance;
}

/** Tests swap in a fresh database. */
export function resetDbForTests(name = `test-${Math.random()}`): AuthorDb {
  db = new AuthorDb(name);
  return db;
}

export function table<T extends TableName>(name: T): EntityTable<TableTypes[T], 'id'> {
  return db[name] as unknown as EntityTable<TableTypes[T], 'id'>;
}
