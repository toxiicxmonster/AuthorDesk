import { db } from './db';
import { archiveRecord, updateRecord } from './repo';
import { collectProject, remapIds } from '../importExport/archive';
import { newId, nowIso } from '../domain/ids';
import { TABLE_NAMES, type ReferenceEntry, type TableName } from '../domain/schema';
import { countMentions } from '../domain/references';
import { normalizeName } from '../domain/text';
import { getDeviceId } from './device';

/**
 * A series: one project holding several books, sharing one set of characters, places and world notes (so the checks,
 * the AI Editor and continuity use the same entry in every book).
 */

export interface CombineReport {
  books: number;
  /** Entries that matched one already in the series (by name or alias) and were merged into it. */
  merged: number;
  /** Entries that were new to the series. */
  added: number;
}

const live = <T>(r: T) => !(r as { archivedAt?: string | null }).archivedAt;

/** Names an entry goes by, normalised for matching ("Winnie Hartley", "Win"). */
const namesOf = (r: Pick<ReferenceEntry, 'name' | 'aliases'>) => [r.name, ...r.aliases].map(normalizeName).filter(Boolean);

/**
 * Merges one entry into another of the same name: the target keeps its values; empty fields, aliases, tags and links
 * are filled in from the other. Pure.
 */
export function mergeEntry(target: ReferenceEntry, other: ReferenceEntry): Partial<ReferenceEntry> {
  const fields = { ...target.fields };
  for (const [k, v] of Object.entries(other.fields)) if (!fields[k]?.trim() && v.trim()) fields[k] = v;
  const aliases = [...new Set([...target.aliases, ...other.aliases, ...(other.name !== target.name ? [other.name] : [])])].filter((a) => a !== target.name);
  const links = [...target.links, ...other.links.filter((l) => l.targetId !== target.id && !target.links.some((t) => t.targetId === l.targetId))];
  return {
    fields,
    aliases,
    tags: [...new Set([...target.tags, ...other.tags])],
    links,
    summary: target.summary.trim() ? target.summary : other.summary,
    notes: target.notes.trim() ? (other.notes.trim() && other.notes !== target.notes ? `${target.notes}\n\n${other.notes}` : target.notes) : other.notes,
    status: target.status || other.status,
    image: target.image || other.image,
  };
}

/**
 * Brings every book of another project into this one, making it a series. Entries with the same name (or alias) as
 * one already here are merged into it; everything that pointed at them follows. The other project is archived, not
 * deleted, so nothing is lost.
 */
export async function combineIntoSeries(targetProjectId: string, sourceProjectId: string): Promise<CombineReport> {
  if (targetProjectId === sourceProjectId) throw new Error('Choose a different project to bring in.');
  const [target, source] = await Promise.all([db.projects.get(targetProjectId), db.projects.get(sourceProjectId)]);
  if (!target || !source) throw new Error('Project not found.');
  const data = await collectProject(sourceProjectId);
  const mine = (await db.references.where('projectId').equals(targetProjectId).toArray()).filter(live);
  const byName = new Map<string, ReferenceEntry>();
  for (const r of mine) for (const n of namesOf(r)) if (!byName.has(n)) byName.set(n, r);

  // New ids for everything coming in, except entries that match one here: those point at the existing entry.
  const map = new Map<string, string>([[sourceProjectId, targetProjectId]]);
  const merges: [ReferenceEntry, ReferenceEntry][] = [];
  for (const r of data.references.filter(live)) {
    const match = r.type && namesOf(r).map((n) => byName.get(n)).find((m) => m && m.type === r.type);
    if (match) {
      map.set(r.id, match.id);
      merges.push([match, r]);
    }
  }
  for (const name of TABLE_NAMES) for (const r of data[name] as { id: string }[]) if (!map.has(r.id)) map.set(r.id, newId());

  const bookCount = await db.books.where('projectId').equals(targetProjectId).count();
  const now = nowIso();
  const deviceId = getDeviceId();
  const tables = TABLE_NAMES.filter((n) => n !== 'projects');
  await db.transaction('rw', [...tables.map((n) => db.table(n)), db.changes], async () => {
    for (const name of tables) {
      let rows = (data[name] as { id: string; archivedAt?: string | null }[]).filter((r) => !(name === 'references' && merges.some(([, o]) => o.id === r.id)));
      rows = rows.map((r) => remapIds(r, map));
      if (name === 'books') rows = (rows as unknown as { order: number }[]).map((b) => ({ ...b, order: bookCount + b.order })) as never;
      const stamped = rows.map((r) => ({ ...r, projectId: targetProjectId, rev: 1, updatedAt: now }));
      if (!stamped.length) continue;
      await db.table(name).bulkAdd(stamped);
      await db.changes.bulkAdd(stamped.map((r) => ({ table: name as TableName, recordId: r.id, projectId: targetProjectId, rev: 1, op: 'put' as const, at: now, deviceId })));
    }
  });
  for (const [into, other] of merges) {
    const cur = (await db.references.get(into.id)) ?? into;
    await updateRecord('references', into.id, mergeEntry(cur, remapIds(other, map)));
  }
  await updateRecord('projects', targetProjectId, { kind: 'series' });
  await archiveRecord('projects', sourceProjectId);
  return { books: data.books.filter(live).length, merged: merges.length, added: data.references.filter(live).length - merges.length };
}

export interface Appearance {
  referenceId: string;
  /** Mentions in each book, in series order. */
  perBook: number[];
  /** Where the entry first appears: book index and chapter title. */
  first: { book: number; chapterTitle: string; sceneId: string } | null;
}

export interface SeriesBook {
  bookId: string;
  title: string;
  /** Scenes in reading order with their chapter titles. */
  scenes: { sceneId: string; chapterTitle: string; text: string }[];
}

/** Where each entry appears across the books of a series: mentions per book, and its first appearance. Pure. */
export function seriesAppearances(books: readonly SeriesBook[], refs: readonly ReferenceEntry[]): Appearance[] {
  return refs
    .filter(live)
    .map((r) => {
      let first: Appearance['first'] = null;
      const perBook = books.map((b, bi) =>
        b.scenes.reduce((n, s) => {
          const c = countMentions(s.text, r);
          if (c && !first) first = { book: bi, chapterTitle: s.chapterTitle, sceneId: s.sceneId };
          return n + c;
        }, 0),
      );
      return { referenceId: r.id, perBook, first };
    });
}

/** The books of a project with their scenes, for the series page. */
export async function loadSeriesBooks(projectId: string): Promise<SeriesBook[]> {
  const books = (await db.books.where('projectId').equals(projectId).toArray()).filter(live).sort((a, b) => a.order - b.order);
  const out: SeriesBook[] = [];
  for (const b of books) {
    const chapters = (await db.chapters.where('bookId').equals(b.id).toArray()).filter(live).sort((a, c) => a.order - c.order);
    const idx = new Map(chapters.map((c, i) => [c.id, i]));
    const scenes = (await db.scenes.where('chapterId').anyOf(chapters.map((c) => c.id)).toArray())
      .filter(live)
      .sort((a, c) => idx.get(a.chapterId)! - idx.get(c.chapterId)! || a.order - c.order);
    out.push({ bookId: b.id, title: b.title, scenes: scenes.map((s) => ({ sceneId: s.id, chapterTitle: chapters[idx.get(s.chapterId)!].title || `Chapter ${idx.get(s.chapterId)! + 1}`, text: s.plainText })) });
  }
  return out;
}
