import type { Chapter, PlotThread, Scene, TimelineEvent } from './schema';

export interface ContinuityFlag {
  characterId: string;
  when: string;
  locations: string[];
  sources: string[];
  message: string;
}

/**
 * Flag a character placed at two different locations at the same in-world time.
 * Advisory only: travel, visions, flashbacks and magic are all legitimate explanations.
 */
export function continuityFlags(events: TimelineEvent[], scenes: Scene[]): ContinuityFlag[] {
  type Sighting = { when: string; location: string; source: string };
  const byChar = new Map<string, Sighting[]>();
  const add = (charId: string, s: Sighting) => {
    if (!byChar.has(charId)) byChar.set(charId, []);
    byChar.get(charId)!.push(s);
  };
  for (const e of events) {
    if (e.archivedAt || !e.locationId) continue;
    const when = e.sortKey !== null ? `#${e.sortKey}` : e.when.trim().toLowerCase();
    if (!when) continue;
    for (const c of e.characterIds) add(c, { when, location: e.locationId, source: `event:${e.id}` });
  }
  for (const s of scenes) {
    if (s.archivedAt || !s.locationId || !s.povCharacterId || !s.timeMarker.trim()) continue;
    add(s.povCharacterId, { when: s.timeMarker.trim().toLowerCase(), location: s.locationId, source: `scene:${s.id}` });
  }
  const flags: ContinuityFlag[] = [];
  for (const [characterId, sightings] of byChar) {
    const byWhen = new Map<string, Sighting[]>();
    for (const s of sightings) {
      if (!byWhen.has(s.when)) byWhen.set(s.when, []);
      byWhen.get(s.when)!.push(s);
    }
    for (const [when, list] of byWhen) {
      const locs = [...new Set(list.map((l) => l.location))];
      if (locs.length > 1) {
        flags.push({
          characterId,
          when,
          locations: locs,
          sources: list.map((l) => l.source),
          message: 'appears in more than one place at the same time',
        });
      }
    }
  }
  return flags;
}

/** Sort events chronologically: numeric sort key first, then undated events in creation order. */
export function chronological(events: TimelineEvent[]): TimelineEvent[] {
  return events.slice().sort((a, b) => {
    if (a.sortKey !== null && b.sortKey !== null) return a.sortKey - b.sortKey;
    if (a.sortKey !== null) return -1;
    if (b.sortKey !== null) return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export interface ThreadAppearance {
  threadId: string;
  /** Chapter indexes (in reading order) where the thread appears. */
  chapters: number[];
  lastIndex: number | null;
  gap: number;
  stale: boolean;
}

/**
 * Where each plot thread appears across chapters, and whether it has gone quiet for at least
 * `threshold` chapters. Never declares a thread abandoned; the UI only suggests a review.
 */
export function threadAppearances(
  threads: PlotThread[],
  chapters: Chapter[],
  scenes: Scene[],
  cardChapterLinks: { chapterId: string | null; plotThreadIds: string[] }[],
  threshold: number,
): ThreadAppearance[] {
  const index = new Map(chapters.map((c, i) => [c.id, i]));
  const hits = new Map<string, Set<number>>();
  const mark = (t: string, chapterId: string | null) => {
    if (!chapterId) return;
    const i = index.get(chapterId);
    if (i === undefined) return;
    if (!hits.has(t)) hits.set(t, new Set());
    hits.get(t)!.add(i);
  };
  for (const s of scenes) if (!s.archivedAt) for (const t of s.plotThreadIds) mark(t, s.chapterId);
  for (const c of cardChapterLinks) for (const t of c.plotThreadIds) mark(t, c.chapterId);
  const total = chapters.length;
  return threads.map((t) => {
    const list = [...(hits.get(t.id) ?? [])].sort((a, b) => a - b);
    const lastIndex = list.length ? list[list.length - 1] : null;
    const gap = lastIndex === null ? total : total - 1 - lastIndex;
    return {
      threadId: t.id,
      chapters: list,
      lastIndex,
      gap,
      stale: t.status === 'open' && list.length > 0 && gap >= threshold,
    };
  });
}
