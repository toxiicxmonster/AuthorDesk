import { beatPosition } from './boardTemplates';

/**
 * Mapping a draft to a story structure: for each beat card, the scene at the point in the book where that beat
 * usually falls (by word count). A starting suggestion the author accepts or changes. Pure.
 */

export interface BeatCard {
  id: string;
  title: string;
}

export interface DraftScene {
  sceneId: string;
  chapterId: string;
  words: number;
}

/** How far through the book each beat belongs: from the template it came from, or by its place among the beats. */
export function beatPositions(beats: readonly BeatCard[]): Map<string, number> {
  return new Map(beats.map((b, i) => [b.id, beatPosition(b.title) ?? (i + 0.5) / beats.length]));
}

/** The scene whose words span a point in the book (0–1 of the way through). */
export function sceneAt(scenes: readonly DraftScene[], at: number): DraftScene | null {
  const total = scenes.reduce((n, s) => n + s.words, 0);
  if (!scenes.length) return null;
  if (!total) return scenes[Math.min(scenes.length - 1, Math.floor(at * scenes.length))];
  let seen = 0;
  for (const s of scenes) {
    seen += s.words;
    if (seen / total >= at) return s;
  }
  return scenes[scenes.length - 1];
}

/** Where each scene starts, as a share of the way through the book. */
export function scenePositions(scenes: readonly DraftScene[]): Map<string, number> {
  const total = scenes.reduce((n, s) => n + s.words, 0) || 1;
  let seen = 0;
  return new Map(
    scenes.map((s) => {
      const at = seen / total;
      seen += s.words;
      return [s.sceneId, at];
    }),
  );
}

export function suggestByPosition(beats: readonly BeatCard[], scenes: readonly DraftScene[]): { beatId: string; sceneId: string | null; at: number }[] {
  const pos = beatPositions(beats);
  return beats.map((b) => ({ beatId: b.id, sceneId: sceneAt(scenes, pos.get(b.id)!)?.sceneId ?? null, at: pos.get(b.id)! }));
}
