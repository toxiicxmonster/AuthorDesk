import { db } from '../storage/db';
import type { CharacterInfo } from './characterFacts';
import { placeFacts, type ContinuityScene, type PlacedFact } from './continuity';
import { birthDate, entryAge, sceneDates, type StoryDate } from './ages';
import type { ReferenceEntry } from '../domain/schema';

const live = <T>(r: T) => !(r as { archivedAt?: string | null }).archivedAt;
const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;

/** A scene's stored text as paragraphs (the same breaks the editor uses). */
export const paragraphsOf = (plainText: string) => plainText.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && p !== '* * *');

/**
 * Every scene of the book a scene belongs to, in reading order, with chapter positions and titles. In a series
 * (a project with several books), every book's scenes, so continuity spans the series.
 */
export async function bookScenesFor(sceneId: string): Promise<ContinuityScene[] | null> {
  const scene = await db.scenes.get(sceneId);
  const chapter = scene && (await db.chapters.get(scene.chapterId));
  if (!scene || !chapter) return null;
  return (await seriesScenes(chapter.projectId)) ?? bookScenes(chapter.bookId);
}

/** Every scene of every book in a series, in reading order, titled "Book · Chapter"; null for a one-book project. */
export async function seriesScenes(projectId: string): Promise<ContinuityScene[] | null> {
  const books = (await db.books.where('projectId').equals(projectId).toArray()).filter(live).sort(byOrder);
  if (books.length < 2) return null;
  const out: ContinuityScene[] = [];
  for (const [bookIndex, b] of books.entries()) {
    for (const s of await bookScenes(b.id)) out.push({ ...s, bookIndex, chapterTitle: `${b.title || `Book ${bookIndex + 1}`} · ${s.chapterTitle}` });
  }
  return out;
}

export async function bookScenes(bookId: string): Promise<ContinuityScene[]> {
  const chapters = (await db.chapters.where('bookId').equals(bookId).toArray()).filter(live).sort(byOrder);
  const index = new Map(chapters.map((c, i) => [c.id, i]));
  const scenes = (await db.scenes.where('chapterId').anyOf(chapters.map((c) => c.id)).toArray())
    .filter(live)
    .sort((a, b) => index.get(a.chapterId)! - index.get(b.chapterId)! || a.order - b.order);
  return scenes.map((s) => {
    const i = index.get(s.chapterId)!;
    return { sceneId: s.id, chapterId: s.chapterId, chapterIndex: i, chapterTitle: chapters[i].title || `Chapter ${i + 1}`, paragraphs: paragraphsOf(s.plainText) };
  });
}

// Details per scene, reused while its text and the character list are unchanged (re-checks happen on every pause).
const cache = new Map<string, { key: string; facts: PlacedFact[] }>();

export function placeFactsCached(scenes: readonly ContinuityScene[], chars: readonly CharacterInfo[]): PlacedFact[] {
  const charKey = chars.map((c) => `${c.id}:${c.name}:${c.aliases.join(',')}`).join('|');
  const out: PlacedFact[] = [];
  for (const s of scenes) {
    const key = `${charKey}\u0001${s.chapterIndex}\u0001${s.chapterTitle}\u0001${s.paragraphs.join('\u0002')}`;
    let hit = cache.get(s.sceneId);
    if (!hit || hit.key !== key) {
      hit = { key, facts: placeFacts([s], chars) };
      cache.set(s.sceneId, hit);
    }
    out.push(...hit.facts);
  }
  return out;
}

/** The text of a character's entry where a birth date might be written (any field, the summary, the notes). */
export const entryText = (r: Pick<ReferenceEntry, 'summary' | 'notes' | 'fields' | 'status'>) => [r.summary, r.status, ...Object.values(r.fields), r.notes].join('\n');

/** Scene dates from the project's timeline, and characters' birth dates and ages from their entries, for the age check. */
export async function storyDates(projectId: string, scenes: readonly ContinuityScene[], characters: readonly ReferenceEntry[]): Promise<{ dates: Map<string, StoryDate>; births: Map<string, StoryDate>; startAges: Map<string, number> }> {
  const events = (await db.timelineEvents.where('projectId').equals(projectId).toArray()).filter(live);
  const dates = sceneDates(events, scenes.filter((s) => s.chapterId).map((s) => ({ sceneId: s.sceneId, chapterId: s.chapterId! })));
  const births = new Map<string, StoryDate>();
  const startAges = new Map<string, number>();
  for (const c of characters) {
    const b = birthDate(entryText(c));
    if (b) births.set(c.id, b);
    const age = entryAge(c.fields, c.notes);
    if (age !== null) startAges.set(c.id, age);
  }
  return { dates, births, startAges };
}
