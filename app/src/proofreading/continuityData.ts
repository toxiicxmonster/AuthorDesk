import { db } from '../storage/db';
import type { CharacterInfo } from './characterFacts';
import { placeFacts, type ContinuityScene, type PlacedFact } from './continuity';

const live = <T>(r: T) => !(r as { archivedAt?: string | null }).archivedAt;
const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;

/** A scene's stored text as paragraphs (the same breaks the editor uses). */
export const paragraphsOf = (plainText: string) => plainText.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p && p !== '* * *');

/** Every scene of the book a scene belongs to, in reading order, with chapter positions and titles. */
export async function bookScenesFor(sceneId: string): Promise<ContinuityScene[] | null> {
  const scene = await db.scenes.get(sceneId);
  const chapter = scene && (await db.chapters.get(scene.chapterId));
  if (!scene || !chapter) return null;
  return bookScenes(chapter.bookId);
}

export async function bookScenes(bookId: string): Promise<ContinuityScene[]> {
  const chapters = (await db.chapters.where('bookId').equals(bookId).toArray()).filter(live).sort(byOrder);
  const index = new Map(chapters.map((c, i) => [c.id, i]));
  const scenes = (await db.scenes.where('chapterId').anyOf(chapters.map((c) => c.id)).toArray())
    .filter(live)
    .sort((a, b) => index.get(a.chapterId)! - index.get(b.chapterId)! || a.order - b.order);
  return scenes.map((s) => {
    const i = index.get(s.chapterId)!;
    return { sceneId: s.id, chapterIndex: i, chapterTitle: chapters[i].title || `Chapter ${i + 1}`, paragraphs: paragraphsOf(s.plainText) };
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
