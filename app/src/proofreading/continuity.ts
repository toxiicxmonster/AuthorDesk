import { extractCharacterFacts, sameValue, type CharacterInfo, type FoundFact } from './characterFacts';
import { analyzeDialogue } from './dialogue';

/**
 * Continuity across the book: the same character described differently in different places ("green eyes" in
 * Chapter 2, "grey eyes" in Chapter 9), and characters speaking after their entry says they died. Pure.
 */

export interface ContinuityScene {
  sceneId: string;
  /** Position of the scene's chapter in reading order (0-based). */
  chapterIndex: number;
  chapterTitle: string;
  paragraphs: string[];
  /** In a series, which book (0-based); chapterIndex counts within that book. */
  bookIndex?: number;
  chapterId?: string;
}

export interface PlacedFact extends FoundFact {
  sceneId: string;
  chapterIndex: number;
  chapterTitle: string;
  block: number;
}

export interface Contradiction {
  /** Stable key, also used to remember "changed on purpose". */
  key: string;
  characterId: string;
  characterName: string;
  label: string;
  /** Where the detail is first described one way… */
  first: PlacedFact;
  /** …and where it's later described another way. */
  other: PlacedFact;
  note: string;
}

export interface CharacterWithStatus extends CharacterInfo {
  status: string;
}

export interface DeathIssue {
  key: string;
  characterId: string;
  characterName: string;
  /** Chapter (0-based reading order) the entry says they died in. */
  diedIn: number;
  /** The entry's status, as written ("deceased, Book 1 Ch. 14"). */
  status: string;
  sceneId: string;
  chapterIndex: number;
  chapterTitle: string;
  block: number;
  start: number;
  end: number;
  text: string;
}

/** Every detail about listed characters across the scenes, with where it is. */
export function placeFacts(scenes: readonly ContinuityScene[], chars: readonly CharacterInfo[]): PlacedFact[] {
  const out: PlacedFact[] = [];
  for (const s of scenes) {
    s.paragraphs.forEach((p, block) => {
      for (const f of extractCharacterFacts(p, chars, s.paragraphs[block - 1] ?? '')) {
        out.push({ ...f, sceneId: s.sceneId, chapterIndex: s.chapterIndex, chapterTitle: s.chapterTitle, block });
      }
    });
  }
  return out;
}

const OPPOSITE_BUILDS = [new Set(['tall', 'towering', 'lanky', 'gangly']), new Set(['short', 'petite', 'slight'])];

function differ(label: string, a: string, b: string): boolean {
  if (label === 'Build') return OPPOSITE_BUILDS.some((g) => g.has(a)) && OPPOSITE_BUILDS.some((g) => g.has(b)) && !OPPOSITE_BUILDS.some((g) => g.has(a) && g.has(b));
  return !sameValue(a, b);
}

export const contradictionKey = (characterId: string, label: string, a: string, b: string) => `continuity|${characterId}|${label}|${[a, b].sort().join('/')}`;

/**
 * Pairs of places that describe the same character's detail differently, earliest first, minus those the author
 * marked as changed on purpose. Distinctive features (freckles, scars) are presence-only, so they never conflict.
 */
export function findContradictions(
  facts: readonly PlacedFact[],
  dismissed: ReadonlySet<string> = new Set(),
  /** Scenes with a date on the timeline: ages between two of them are checked against the dates instead (ages.ts). */
  datedScenes: ReadonlySet<string> = new Set(),
): Contradiction[] {
  const groups = new Map<string, PlacedFact[]>();
  for (const f of facts) {
    if (f.attribute === 'feature') continue;
    const k = `${f.characterId}|${f.label}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const out: Contradiction[] = [];
  for (const list of groups.values()) {
    const ordered = list.slice().sort((x, y) => x.chapterIndex - y.chapterIndex);
    const first = ordered[0];
    const seenValues = [first.value];
    for (const f of ordered.slice(1)) {
      if (seenValues.some((v) => !differ(f.label, v, f.value))) continue;
      seenValues.push(f.value);
      if (f.attribute === 'age' && datedScenes.has(first.sceneId) && datedScenes.has(f.sceneId)) continue;
      const key = contradictionKey(f.characterId, f.label, first.value, f.value);
      if (dismissed.has(key)) continue;
      out.push({
        key,
        characterId: f.characterId,
        characterName: f.characterName,
        label: f.label,
        first,
        other: f,
        note: f.attribute === 'age' ? 'Fine if time has passed between them.' : '',
      });
    }
  }
  return out.sort((x, y) => x.other.chapterIndex - y.other.chapterIndex);
}

/** The chapter (0-based) a status like "deceased, Ch. 14" or "killed in chapter 9" names; null when not dead or no chapter. */
export function deathChapter(status: string): number | null {
  if (!/\b(?:dead|deceased|died|killed|murdered|slain)\b/i.test(status)) return null;
  const m = /\bch(?:apter|\.)?\s*(\d{1,3})\b/i.exec(status);
  return m ? Math.max(0, parseInt(m[1], 10) - 1) : null;
}

/** In a series, the book (0-based) a status names ("deceased, Book 2 Ch. 14"); null when it doesn't say. */
export function deathBook(status: string): number | null {
  const m = /\bbook\s*(\d{1,2})\b/i.exec(status);
  return m ? Math.max(0, parseInt(m[1], 10) - 1) : null;
}

/** Lines of dialogue spoken by a character after the chapter their entry says they died in (one per scene). */
export function findDeathIssues(scenes: readonly ContinuityScene[], chars: readonly CharacterWithStatus[], names: readonly string[], dismissed: ReadonlySet<string> = new Set()): DeathIssue[] {
  const out: DeathIssue[] = [];
  for (const c of chars) {
    const died = deathChapter(c.status);
    if (died === null) continue;
    const book = deathBook(c.status);
    for (const s of scenes) {
      // "Book 1 Ch. 14": every later book, and later chapters of that book. Without a book: chapters of each book.
      if (book !== null && s.bookIndex !== undefined) {
        if (s.bookIndex < book || (s.bookIndex === book && s.chapterIndex <= died)) continue;
      } else if (s.chapterIndex <= died) continue;
      const line = analyzeDialogue(s.paragraphs, names).lines.find((l) => l.speaker === c.name);
      if (!line) continue;
      const key = `continuity|dead|${c.id}|${s.sceneId}`;
      if (dismissed.has(key)) continue;
      out.push({ key, characterId: c.id, characterName: c.name, diedIn: died, status: c.status.trim(), sceneId: s.sceneId, chapterIndex: s.chapterIndex, chapterTitle: s.chapterTitle, block: line.block, start: line.start, end: line.end, text: line.text });
    }
  }
  return out;
}
