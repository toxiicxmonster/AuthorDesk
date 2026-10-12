import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';
import type { Book, Chapter, Part, Project, ReferenceEntry, Scene, TableTypes } from '../domain/schema';

const live = <T>(r: T) => !(r as { archivedAt?: string | null }).archivedAt;
const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;

export function useProjects(): Project[] | undefined {
  return useLiveQuery(async () => (await db.projects.toArray()).filter(live).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), []);
}

/** undefined while loading, null if it does not exist. Results from a previous id are never returned. */
export function useProject(projectId: string | null): Project | undefined | null {
  const r = useLiveQuery(async () => ({ id: projectId, project: projectId ? ((await db.projects.get(projectId)) ?? null) : null }), [projectId]);
  return r && r.id === projectId ? r.project : undefined;
}

export function useBooks(projectId: string | null): Book[] {
  return (
    useLiveQuery(
      async () => (projectId ? (await db.books.where('projectId').equals(projectId).toArray()).filter(live).sort(byOrder) : []),
      [projectId],
    ) ?? []
  );
}

export interface ManuscriptTree {
  parts: Part[];
  chapters: Chapter[];
  scenesByChapter: Map<string, Scene[]>;
  /** Flat reading order of scenes across the book. */
  sceneOrder: Scene[];
  wordCount: number;
}

/** Load a book's manuscript hierarchy. Scene content is excluded from the tree to keep it light. */
export function useManuscript(bookId: string | null): ManuscriptTree | undefined {
  const r = useLiveQuery(async () => {
    if (!bookId) return { bookId, parts: [], chapters: [], scenesByChapter: new Map(), sceneOrder: [], wordCount: 0 };
    const [parts, chapters] = await Promise.all([
      db.parts.where('bookId').equals(bookId).toArray(),
      db.chapters.where('bookId').equals(bookId).toArray(),
    ]);
    const liveChapters = chapters.filter(live).sort(byOrder);
    const scenes = await db.scenes.where('chapterId').anyOf(liveChapters.map((c) => c.id)).toArray();
    const scenesByChapter = new Map<string, Scene[]>();
    for (const c of liveChapters) scenesByChapter.set(c.id, []);
    for (const s of scenes.filter(live)) scenesByChapter.get(s.chapterId)?.push(s);
    for (const list of scenesByChapter.values()) list.sort(byOrder);
    const orderedParts = parts.filter(live).sort(byOrder);
    const sceneOrder = orderChapters(liveChapters, orderedParts).flatMap((c) => scenesByChapter.get(c.id) ?? []);
    const wordCount = sceneOrder.reduce((n, s) => n + s.wordCount, 0);
    return { bookId, parts: orderedParts, chapters: liveChapters, scenesByChapter, sceneOrder, wordCount };
  }, [bookId]);
  return r && r.bookId === bookId ? r : undefined;
}

/** Chapters ordered by part (parts first in their order, unassigned chapters by their own order). */
export function orderChapters(chapters: Chapter[], _parts: Part[]): Chapter[] {
  return chapters.slice().sort(byOrder);
}

export function useReferences(projectId: string | null): ReferenceEntry[] {
  return (
    useLiveQuery(
      async () =>
        projectId
          ? (await db.references.where('projectId').equals(projectId).toArray()).sort((a, b) => a.name.localeCompare(b.name))
          : [],
      [projectId],
    ) ?? []
  );
}

export function useProjectTable<T extends 'plotThreads' | 'timelineEvents' | 'notes' | 'boardLanes' | 'boardCards' | 'dictionary'>(
  name: T,
  projectId: string | null,
): TableTypes[T][] {
  return (useLiveQuery(async () => (projectId ? await db[name].where('projectId').equals(projectId).toArray() : []), [name, projectId]) ??
    []) as TableTypes[T][];
}

export function useScene(sceneId: string | null): Scene | null | undefined {
  const r = useLiveQuery(async () => ({ id: sceneId, scene: sceneId ? ((await db.scenes.get(sceneId)) ?? null) : null }), [sceneId]);
  return r && r.id === sceneId ? r.scene : undefined;
}

const RECENT_KEY = 'authordesk.recent';

/** Recently opened scenes per project (per-device convenience, safe to lose). */
export function pushRecent(projectId: string, sceneId: string) {
  try {
    const all = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '{}') as Record<string, string[]>;
    all[projectId] = [sceneId, ...(all[projectId] ?? []).filter((x) => x !== sceneId)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

export function getRecent(projectId: string): string[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '{}') as Record<string, string[]>)[projectId] ?? [];
  } catch {
    return [];
  }
}
