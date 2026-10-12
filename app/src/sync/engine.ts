import { db, table } from '../storage/db';
import { PROJECT_TABLES, type TableName } from '../domain/schema';
import { newId, nowIso } from '../domain/ids';
import { getDeviceId } from '../storage/device';
import { createSnapshot } from '../storage/repo';
import { threeWayMerge, type Rec } from './merge';
import type { PushResult, SyncRecord } from './types';

/** Tables that sync. Snapshots stay on each device (they are recovery history, and large). */
export const SYNC_TABLES: TableName[] = [
  'projects', 'books', 'parts', 'chapters', 'scenes', 'references', 'plotThreads', 'timelineEvents',
  'boardLanes', 'boardCards', 'notes', 'dictionary',
];
const SYNCED = new Set<string>(SYNC_TABLES);

export interface PushChange {
  record: Omit<SyncRecord, 'serverVersion'>;
  baseVersion: number | null;
}

export interface SyncTransport {
  pull(since: string): Promise<{ records: SyncRecord[]; cursor: string; more: boolean }>;
  push(changes: PushChange[], device: string): Promise<PushResult>;
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  merged: number;
  conflicts: number;
  rejectedRetries: number;
}

const CURSOR_KEY = 'sync:cursor';
const metaKey = (t: string, id: string) => `${t}:${id}`;

async function getCursor(): Promise<string> {
  return ((await db.settings.get(CURSOR_KEY))?.value as string) ?? '0';
}

/** Records created before sign-in (or imported) get queued once so the server receives everything. */
export async function enqueueUnsynced(): Promise<number> {
  const metaKeys = new Set((await db.syncMeta.toCollection().primaryKeys()) as string[]);
  const pending = new Set((await db.changes.toArray()).map((c) => c.recordId));
  let n = 0;
  for (const t of SYNC_TABLES) {
    const rows = (await table(t).toArray()) as { id: string; projectId: string; rev: number }[];
    for (const r of rows) {
      if (metaKeys.has(metaKey(t, r.id)) || pending.has(r.id)) continue;
      await db.changes.add({ table: t, recordId: r.id, projectId: r.projectId, rev: r.rev, op: 'put', at: nowIso(), deviceId: getDeviceId() });
      n++;
    }
  }
  return n;
}

/** Apply one record from the server, merging with any unsynced local edit. Never silently loses prose. */
async function applyRemote(rec: SyncRecord, report: SyncReport) {
  if (!SYNCED.has(rec.table)) return;
  const t = rec.table as TableName;
  const key = metaKey(t, rec.id);
  const meta = await db.syncMeta.get(key);
  if (meta && rec.serverVersion <= meta.serverVersion) return; // already have it (often our own push echoing back)

  let remoteData: Rec | null = null;
  if (!rec.deleted && rec.data) {
    const parsed = PROJECT_TABLES[t].safeParse(rec.data);
    if (!parsed.success) return; // malformed or from an incompatible version: leave local untouched
    remoteData = parsed.data as Rec;
  }
  const local = (await table(t).get(rec.id as never)) as Rec | undefined;
  const pending = await db.changes.where('recordId').equals(rec.id).first();
  const setMeta = (base: Rec | null) => db.syncMeta.put({ key, serverVersion: rec.serverVersion, base });

  // No local edits waiting: the server copy is simply newer.
  if (!pending) {
    if (!remoteData) {
      if (local) await table(t).delete(rec.id as never);
    } else {
      if (t === 'scenes' && local && local.plainText !== remoteData.plainText) {
        await createSnapshot(local as never, 'before sync update');
      }
      await table(t).put(remoteData as never);
    }
    await setMeta(remoteData);
    report.pulled++;
    return;
  }

  // Local delete vs remote edit: the edit wins so writing is never lost.
  if (!local) {
    if (remoteData) {
      await table(t).put(remoteData as never);
      await db.changes.where('recordId').equals(rec.id).delete();
    }
    await setMeta(remoteData);
    report.pulled++;
    return;
  }
  // Remote delete vs local edit: keep the local record; it will be re-created on the server.
  if (!remoteData) {
    await setMeta(null);
    return;
  }

  const outcome = threeWayMerge(meta?.base ?? null, local, remoteData);
  switch (outcome.kind) {
    case 'take-remote':
      await table(t).put(remoteData as never);
      await db.changes.where('recordId').equals(rec.id).delete();
      report.pulled++;
      break;
    case 'keep-local':
      break;
    case 'merged': {
      const merged = { ...outcome.result, rev: Math.max(Number(local.rev) || 0, Number(remoteData.rev) || 0) + 1 };
      await table(t).put(merged as never);
      report.merged++;
      break;
    }
    case 'conflict': {
      const merged = { ...outcome.result, rev: Math.max(Number(local.rev) || 0, Number(remoteData.rev) || 0) + 1 };
      await table(t).put(merged as never);
      // Preserve the other device's version: a snapshot (for prose) and a conflict entry to resolve.
      if (t === 'scenes') {
        await createSnapshot({ ...(remoteData as object), id: rec.id } as never, 'conflict: other device');
      }
      await db.conflicts.add({
        id: newId(),
        projectId: String(local.projectId),
        table: t,
        recordId: rec.id,
        title: String(local.title ?? local.name ?? rec.id),
        other: remoteData,
        createdAt: nowIso(),
      });
      report.conflicts++;
      break;
    }
  }
  await setMeta(remoteData);
}

async function pullAll(transport: SyncTransport, report: SyncReport) {
  let since = await getCursor();
  for (let guard = 0; guard < 1000; guard++) {
    const page = await transport.pull(since);
    for (const rec of page.records) await applyRemote(rec, report);
    since = page.cursor;
    await db.settings.put({ key: CURSOR_KEY, value: since });
    if (!page.more) break;
  }
}

async function pushAll(transport: SyncTransport, report: SyncReport): Promise<number> {
  const entries = await db.changes.toArray();
  // Local-only tables never leave the device.
  const skip = entries.filter((e) => !SYNCED.has(e.table));
  if (skip.length) await db.changes.bulkDelete(skip.map((e) => e.seq!));
  const todo = entries.filter((e) => SYNCED.has(e.table));
  let rejected = 0;
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const changes: PushChange[] = [];
    const sent = new Map<string, { rev: number; data: Rec | null; seq: number }>();
    for (const e of batch) {
      const rec = (await table(e.table).get(e.recordId as never)) as Rec | undefined;
      const meta = await db.syncMeta.get(metaKey(e.table, e.recordId));
      changes.push({
        record: { table: e.table, id: e.recordId, projectId: e.projectId, rev: Number(rec?.rev ?? e.rev), deleted: !rec, data: rec ?? null },
        baseVersion: meta ? meta.serverVersion : null,
      });
      sent.set(metaKey(e.table, e.recordId), { rev: Number(rec?.rev ?? -1), data: rec ?? null, seq: e.seq! });
    }
    const result = await transport.push(changes, getDeviceId());
    for (const a of result.accepted) {
      const k = metaKey(a.table, a.id);
      const s = sent.get(k)!;
      await db.syncMeta.put({ key: k, serverVersion: a.serverVersion, base: s.data });
      // Only clear the queue entry if nothing changed locally while we were uploading.
      const now = (await table(a.table).get(a.id as never)) as Rec | undefined;
      if ((now ? Number(now.rev) : -1) === s.rev) await db.changes.where('recordId').equals(a.id).delete();
      report.pushed++;
    }
    rejected += result.rejected.length;
  }
  return rejected;
}

/** One full sync round: pull, merge, push; retries when the server reports newer versions. */
export async function syncOnce(transport: SyncTransport): Promise<SyncReport> {
  const report: SyncReport = { pulled: 0, pushed: 0, merged: 0, conflicts: 0, rejectedRetries: 0 };
  await enqueueUnsynced();
  for (let attempt = 0; attempt < 4; attempt++) {
    await pullAll(transport, report);
    const rejected = await pushAll(transport, report);
    if (!rejected) return report;
    report.rejectedRetries++;
  }
  throw new Error('Sync could not settle: another device keeps changing the same records. Try again shortly.');
}

/** Resolve a conflict: keep this device's version, use the other device's, or (scenes) keep both. */
export async function resolveConflict(conflictId: string, choice: 'mine' | 'theirs' | 'both') {
  const c = await db.conflicts.get(conflictId);
  if (!c) return;
  const t = c.table as TableName;
  const local = (await table(t).get(c.recordId as never)) as Rec | undefined;
  if (choice === 'theirs' && local) {
    if (t === 'scenes') await createSnapshot(local as never, 'before using other device version');
    await table(t).put({ ...c.other, rev: Number(local.rev) + 1, updatedAt: nowIso() } as never);
    await queue(t, c.recordId, String(local.projectId), Number(local.rev) + 1);
  } else if (choice === 'both' && t === 'scenes' && local) {
    const copy = { ...c.other, id: newId(), title: `${c.other.title ?? 'Scene'} (other device)`, order: Number(local.order) + 0.5, rev: 1, createdAt: nowIso(), updatedAt: nowIso() };
    await table('scenes').add(copy as never);
    await queue('scenes', String(copy.id), String(local.projectId), 1);
    const siblings = (await db.scenes.where('chapterId').equals(String(local.chapterId)).toArray()).filter((s) => !s.archivedAt).sort((a, b) => a.order - b.order);
    for (let i = 0; i < siblings.length; i++) if (siblings[i].order !== i) {
      await db.scenes.update(siblings[i].id, { order: i, rev: siblings[i].rev + 1 });
      await queue('scenes', siblings[i].id, siblings[i].projectId, siblings[i].rev + 1);
    }
  }
  await db.conflicts.delete(conflictId);
}

async function queue(t: TableName, id: string, projectId: string, rev: number) {
  await db.changes.where('recordId').equals(id).delete();
  await db.changes.add({ table: t, recordId: id, projectId, rev, op: 'put', at: nowIso(), deviceId: getDeviceId() });
}

/** Same-origin HTTP transport. The session lives in an HttpOnly cookie; no token is ever readable by scripts. */
export const httpTransport: SyncTransport = {
  async pull(since) {
    const r = await api(`/api/sync/pull?since=${encodeURIComponent(since)}`);
    return r as Awaited<ReturnType<SyncTransport['pull']>>;
  },
  async push(changes, device) {
    return (await api('/api/sync/push', { changes, device })) as PushResult;
  },
};

export class SyncHttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api(path: string, body?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: { 'X-AuthorDesk': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new SyncHttpError('Could not reach the sync server (offline or server down).', 0);
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new SyncHttpError((data as { error?: string })?.error ?? `Sync server error (HTTP ${res.status})`, res.status);
  if (!data) throw new SyncHttpError('This address has no AuthorDesk sync server.', 404);
  return data;
}
