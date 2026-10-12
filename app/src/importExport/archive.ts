import { strToU8, strFromU8, unzipSync, zipSync, type Unzipped } from 'fflate';
import { db, table } from '../storage/db';
import { PROJECT_TABLES, SCHEMA_VERSION, TABLE_NAMES, type TableName, type TableTypes } from '../domain/schema';
import { migrateRecord } from '../storage/migrations';
import { newId, nowIso } from '../domain/ids';
import { getSettings } from '../storage/settings';
import { createSnapshot } from '../storage/repo';

export const ARCHIVE_FORMAT = 'authordesk-archive';
export const ARCHIVE_FORMAT_VERSION = 1;
export const ARCHIVE_EXTENSION = '.authorproj';

/** Safety limits for imported archives. */
export const LIMITS = {
  maxArchiveBytes: 500 * 1024 * 1024,
  maxEntryBytes: 250 * 1024 * 1024,
  maxTotalUncompressed: 1024 * 1024 * 1024,
  maxEntries: 200,
  maxRecordsPerTable: 500_000,
};

export interface ArchiveManifest {
  format: typeof ARCHIVE_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  app: string;
  exportedAt: string;
  project: { id: string; name: string };
  counts: Partial<Record<TableName, number>>;
  /** SHA-256 hex of each data file, for integrity checking. */
  checksums: Record<string, string>;
}

export type ProjectData = { [K in TableName]: TableTypes[K][] };

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Read every record belonging to a project. */
export async function collectProject(projectId: string): Promise<ProjectData> {
  const out = {} as ProjectData;
  for (const name of TABLE_NAMES) {
    const rows =
      name === 'projects' ? (await db.projects.where('id').equals(projectId).toArray()) : await table(name).where('projectId').equals(projectId).toArray();
    (out as Record<string, unknown[]>)[name] = rows;
  }
  return out;
}

/** Build a complete, restorable project archive (zip). */
export async function buildArchive(projectId: string, opts: { includeSnapshots?: boolean } = {}): Promise<{ bytes: Uint8Array; manifest: ArchiveManifest }> {
  const data = await collectProject(projectId);
  const project = data.projects[0];
  if (!project) throw new Error('Project not found');
  if (opts.includeSnapshots === false) data.snapshots = [];
  const files: Record<string, Uint8Array> = {};
  const checksums: Record<string, string> = {};
  const counts: Partial<Record<TableName, number>> = {};
  for (const name of TABLE_NAMES) {
    const path = `data/${name}.json`;
    const bytes = strToU8(JSON.stringify(data[name]));
    files[path] = bytes;
    checksums[path] = await sha256Hex(bytes);
    counts[name] = data[name].length;
  }
  const settings = await getSettings();
  const prefs = { ...settings, lastProjectId: null, lastBackupAt: null };
  const prefBytes = strToU8(JSON.stringify(prefs));
  files['preferences.json'] = prefBytes;
  checksums['preferences.json'] = await sha256Hex(prefBytes);
  const templates = (await db.settings.get('boardTemplates'))?.value ?? [];
  const tplBytes = strToU8(JSON.stringify(templates));
  files['boardTemplates.json'] = tplBytes;
  checksums['boardTemplates.json'] = await sha256Hex(tplBytes);
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    app: 'AuthorDesk',
    exportedAt: nowIso(),
    project: { id: project.id, name: project.name },
    counts,
    checksums,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  files['README.txt'] = strToU8(
    `AuthorDesk project archive for "${project.name}".\nExported ${manifest.exportedAt}.\n\nRestore it in AuthorDesk via Backup & Sync → Import.\nThe data/ folder holds plain JSON so your work is never locked in.\n`,
  );
  return { bytes: zipSync(files, { level: 6 }), manifest };
}

export interface ParsedArchive {
  manifest: ArchiveManifest;
  data: ProjectData;
  preferences: Record<string, unknown> | null;
  boardTemplates: unknown[];
  warnings: string[];
}

export class ArchiveError extends Error {}

function safePath(p: string): boolean {
  return !p.startsWith('/') && !p.includes('..') && !p.includes('\\') && !/^[a-zA-Z]:/.test(p) && p.length < 300;
}

/** Unzip, validate and migrate an archive. Throws ArchiveError with an actionable message. */
export async function parseArchive(bytes: Uint8Array): Promise<ParsedArchive> {
  if (bytes.length > LIMITS.maxArchiveBytes) throw new ArchiveError('This file is larger than 500 MB and was not imported.');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new ArchiveError('This is not an AuthorDesk archive (it is not a zip file).');
  const warnings: string[] = [];
  let entries: Unzipped;
  let total = 0;
  let count = 0;
  try {
    entries = unzipSync(bytes, {
      filter(f) {
        count++;
        if (count > LIMITS.maxEntries) throw new ArchiveError('The archive contains too many files.');
        if (!safePath(f.name)) {
          warnings.push(`Skipped unsafe path “${f.name}”.`);
          return false;
        }
        if (f.originalSize > LIMITS.maxEntryBytes) throw new ArchiveError(`“${f.name}” is too large.`);
        total += f.originalSize;
        if (total > LIMITS.maxTotalUncompressed) throw new ArchiveError('The archive expands to more than 1 GB.');
        const known = f.name === 'manifest.json' || f.name === 'preferences.json' || f.name === 'boardTemplates.json' || f.name === 'README.txt' || /^data\/[a-zA-Z]+\.json$/.test(f.name);
        if (!known && !f.name.endsWith('/')) warnings.push(`Ignored unknown file “${f.name}”.`);
        return known;
      },
    });
  } catch (e) {
    if (e instanceof ArchiveError) throw e;
    throw new ArchiveError(`The archive could not be opened: ${e instanceof Error ? e.message : e}`);
  }
  const mf = entries['manifest.json'];
  if (!mf) throw new ArchiveError('The archive has no manifest.json, so it is not a complete AuthorDesk archive.');
  let manifest: ArchiveManifest;
  try {
    manifest = JSON.parse(strFromU8(mf));
  } catch {
    throw new ArchiveError('manifest.json is damaged.');
  }
  if (manifest.format !== ARCHIVE_FORMAT) throw new ArchiveError('This zip is not an AuthorDesk archive.');
  if (manifest.formatVersion > ARCHIVE_FORMAT_VERSION || manifest.schemaVersion > SCHEMA_VERSION) {
    warnings.push(
      `This archive was made by a newer AuthorDesk (schema ${manifest.schemaVersion}). Unknown fields are kept, but update the app before relying on this import.`,
    );
  }
  // Integrity
  for (const [path, expected] of Object.entries(manifest.checksums ?? {})) {
    const entry = entries[path];
    if (!entry) {
      if (path.startsWith('data/')) throw new ArchiveError(`The archive is incomplete: ${path} is missing.`);
      continue;
    }
    const actual = await sha256Hex(entry);
    if (actual !== expected) throw new ArchiveError(`Integrity check failed for ${path}. The file may be damaged or edited; it was not imported.`);
  }
  const data = {} as ProjectData;
  for (const name of TABLE_NAMES) {
    const entry = entries[`data/${name}.json`];
    const rows: unknown[] = entry ? JSON.parse(strFromU8(entry)) : [];
    if (!Array.isArray(rows)) throw new ArchiveError(`data/${name}.json is not a list.`);
    if (rows.length > LIMITS.maxRecordsPerTable) throw new ArchiveError(`data/${name}.json has too many records.`);
    const schema = PROJECT_TABLES[name];
    const valid: unknown[] = [];
    let bad = 0;
    for (const raw of rows) {
      const migrated = raw && typeof raw === 'object' ? migrateRecord(name, raw as Record<string, unknown>, manifest.schemaVersion) : raw;
      const r = schema.safeParse(migrated);
      if (r.success) valid.push(r.data);
      else bad++;
    }
    if (bad) warnings.push(`${bad} invalid ${name} record${bad === 1 ? '' : 's'} skipped.`);
    (data as Record<string, unknown[]>)[name] = valid;
  }
  if (data.projects.length !== 1) throw new ArchiveError('The archive must contain exactly one project.');
  const pid = data.projects[0].id;
  for (const name of TABLE_NAMES) {
    const foreign = (data[name] as { projectId: string }[]).filter((r) => r.projectId !== pid).length;
    if (foreign) {
      warnings.push(`${foreign} ${name} record(s) belonged to another project and were skipped.`);
      (data as Record<string, unknown[]>)[name] = (data[name] as { projectId: string }[]).filter((r) => r.projectId === pid);
    }
  }
  const prefs = entries['preferences.json'] ? JSON.parse(strFromU8(entries['preferences.json'])) : null;
  const tpls = entries['boardTemplates.json'] ? JSON.parse(strFromU8(entries['boardTemplates.json'])) : [];
  return { manifest, data, preferences: prefs, boardTemplates: Array.isArray(tpls) ? tpls : [], warnings };
}

export interface ImportPreview {
  projectExists: boolean;
  existingName: string | null;
  perTable: { table: TableName; total: number; new: number; identical: number; differs: number }[];
  idCollisionsElsewhere: number;
}

const strip = (r: object) => {
  const { rev: _r, updatedAt: _u, ...rest } = r as Record<string, unknown>;
  void _r;
  void _u;
  return JSON.stringify(rest);
};

/** Compare an archive with local data without changing anything. */
export async function previewImport(parsed: ParsedArchive): Promise<ImportPreview> {
  const pid = parsed.data.projects[0].id;
  const existing = await db.projects.get(pid);
  const perTable: ImportPreview['perTable'] = [];
  let idCollisionsElsewhere = 0;
  for (const name of TABLE_NAMES) {
    const rows = parsed.data[name] as { id: string; projectId: string }[];
    const ids = rows.map((r) => r.id);
    const locals = await table(name).bulkGet(ids);
    let n = 0;
    let same = 0;
    let diff = 0;
    locals.forEach((l, i) => {
      if (!l) n++;
      else if ((l as { projectId: string }).projectId !== pid) idCollisionsElsewhere++;
      else if (strip(l) === strip(rows[i])) same++;
      else diff++;
    });
    perTable.push({ table: name, total: rows.length, new: n, identical: same, differs: diff });
  }
  return { projectExists: !!existing, existingName: existing?.name ?? null, perTable, idCollisionsElsewhere };
}

export type ImportMode = 'restore' | 'copy' | 'merge';
export type DuplicatePolicy = 'keep-existing' | 'use-imported' | 'keep-both';

export interface ImportReport {
  projectId: string;
  added: number;
  updated: number;
  skipped: number;
  copied: number;
  warnings: string[];
}

/** Replace every occurrence of an old id (as a full string value) anywhere in a record. */
export function remapIds<T>(value: T, map: Map<string, string>): T {
  if (typeof value === 'string') return (map.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => remapIds(v, map)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = remapIds(v, map);
    return out as T;
  }
  return value;
}

/** Give every record a fresh id, rewriting all references between them. */
export function remapProject(data: ProjectData): ProjectData {
  const map = new Map<string, string>();
  for (const name of TABLE_NAMES) for (const r of data[name] as { id: string }[]) map.set(r.id, newId());
  const out = {} as ProjectData;
  for (const name of TABLE_NAMES) (out as Record<string, unknown[]>)[name] = (data[name] as unknown[]).map((r) => remapIds(r, map));
  return out;
}

/**
 * Apply an import.
 * - restore: the project is not on this device; insert it unchanged (ids preserved).
 * - copy: insert as a new, separate project with fresh ids (safe even if the original exists).
 * - merge: merge into the existing project with the same id, following `policy` for records that differ.
 */
export async function applyImport(parsed: ParsedArchive, mode: ImportMode, policy: DuplicatePolicy = 'keep-existing'): Promise<ImportReport> {
  const report: ImportReport = { projectId: '', added: 0, updated: 0, skipped: 0, copied: 0, warnings: [...parsed.warnings] };
  let data = parsed.data;
  if (mode === 'copy') {
    data = remapProject(data);
    data.projects[0] = { ...data.projects[0], name: `${data.projects[0].name} (imported ${new Date().toLocaleDateString()})` };
  }
  const pid = data.projects[0].id;
  report.projectId = pid;
  const exists = await db.projects.get(pid);
  if (mode === 'restore' && exists) throw new ArchiveError('This project already exists on this device. Choose “Merge” or “Import as a copy”.');
  if (mode === 'merge' && !exists) mode = 'restore';

  const tables = TABLE_NAMES.map((n) => table(n));
  await db.transaction('rw', [...tables, db.changes], async () => {
    for (const name of TABLE_NAMES) {
      const rows = data[name] as (TableTypes[TableName] & { id: string; projectId: string })[];
      if (mode !== 'merge') {
        const collisions = (await table(name).bulkGet(rows.map((r) => r.id))).filter(Boolean).length;
        if (collisions) throw new ArchiveError(`${collisions} ${name} id(s) already exist on this device. Use “Import as a copy” instead.`);
        await table(name).bulkAdd(rows as never[]);
        report.added += rows.length;
        continue;
      }
      for (const r of rows) {
        const local = (await table(name).get(r.id)) as (typeof r & { rev: number }) | undefined;
        if (!local) {
          await table(name).add(r as never);
          report.added++;
        } else if (strip(local) === strip(r)) {
          report.skipped++;
        } else if (local.projectId !== pid) {
          report.warnings.push(`Skipped ${name} ${r.id}: the id belongs to another project.`);
          report.skipped++;
        } else if (policy === 'keep-existing' || (name as TableName) === 'projects') {
          report.skipped++;
        } else if (policy === 'use-imported') {
          if (name === 'scenes') await createSnapshot(local as never, 'before import');
          await table(name).put({ ...r, rev: Math.max(local.rev ?? 0, (r as { rev?: number }).rev ?? 0) + 1 } as never);
          report.updated++;
        } else {
          // keep-both: imported version becomes a copy alongside the existing one.
          const copy = { ...r, id: newId() } as Record<string, unknown>;
          if ('title' in copy) copy.title = `${copy.title} (imported)`;
          if ('name' in copy && name !== 'projects') copy.name = `${copy.name} (imported)`;
          await table(name).add(copy as never);
          report.copied++;
        }
      }
    }
  });
  if (parsed.boardTemplates.length) {
    const row = await db.settings.get('boardTemplates');
    const current = (row?.value as { id: string }[]) ?? [];
    const merged = [...current, ...(parsed.boardTemplates as { id: string }[]).filter((t) => t && typeof t.id === 'string' && !current.some((c) => c.id === t.id))];
    await db.settings.put({ key: 'boardTemplates', value: merged });
  }
  return report;
}

/** Plain JSON export of all project data (migration/backups). */
export async function exportJson(projectId: string): Promise<string> {
  const data = await collectProject(projectId);
  return JSON.stringify({ format: 'authordesk-json', schemaVersion: SCHEMA_VERSION, exportedAt: nowIso(), data }, null, 2);
}
