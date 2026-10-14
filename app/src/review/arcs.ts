import type { ReferenceEntry } from '../domain/schema';
import { countMentions } from '../domain/references';
import { analyzeDialogue } from '../proofreading/dialogue';
import type { ContinuityScene } from '../proofreading/continuity';

/**
 * Character arcs: where each character is on the page, chapter by chapter (mentions and lines spoken), when they're
 * first and last seen, and the stretches where they drop out of the story. Pure.
 */

export interface ArcChapter {
  /** "bookIndex:chapterIndex", unique across a series. */
  key: string;
  title: string;
  scenes: ContinuityScene[];
}

export interface CharacterArc {
  referenceId: string;
  name: string;
  /** Per chapter (in reading order): mentions, lines of dialogue, and the first scene they're in. */
  perChapter: { mentions: number; lines: number; sceneId: string | null }[];
  /** Chapter positions (indexes into the chapter list) where they first and last appear; -1 when never. */
  first: number;
  last: number;
  /** Stretches of at least `minGap` chapters without them, after they first appear (the last may run to the end). */
  gaps: { from: number; to: number; toEnd: boolean }[];
}

/** Groups scenes into chapters, in reading order. */
export function arcChapters(scenes: readonly ContinuityScene[]): ArcChapter[] {
  const out: ArcChapter[] = [];
  for (const s of scenes) {
    const key = `${s.bookIndex ?? 0}:${s.chapterIndex}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.scenes.push(s);
    else out.push({ key, title: s.chapterTitle, scenes: [s] });
  }
  return out;
}

export const ARC_GAP = 5;

export function characterArcs(chapters: readonly ArcChapter[], characters: readonly ReferenceEntry[], knownNames: readonly string[], minGap = ARC_GAP): CharacterArc[] {
  // Dialogue once per scene for everyone.
  const speakers = new Map<string, Map<string, number>>();
  for (const ch of chapters)
    for (const s of ch.scenes) {
      const counts = new Map<string, number>();
      for (const l of analyzeDialogue(s.paragraphs, knownNames).lines) if (l.speaker) counts.set(l.speaker, (counts.get(l.speaker) ?? 0) + 1);
      speakers.set(s.sceneId, counts);
    }
  return characters
    .filter((c) => !c.archivedAt && c.type === 'character')
    .map((c) => {
      const perChapter = chapters.map((ch) => {
        let mentions = 0;
        let lines = 0;
        let sceneId: string | null = null;
        for (const s of ch.scenes) {
          const m = countMentions(s.paragraphs.join('\n'), c);
          const l = speakers.get(s.sceneId)?.get(c.name) ?? 0;
          if ((m || l) && !sceneId) sceneId = s.sceneId;
          mentions += m;
          lines += l;
        }
        return { mentions, lines, sceneId };
      });
      const present = perChapter.map((p) => p.mentions + p.lines > 0);
      const first = present.indexOf(true);
      const last = present.lastIndexOf(true);
      const gaps: CharacterArc['gaps'] = [];
      if (first >= 0) {
        let run = -1;
        for (let i = first + 1; i <= present.length; i++) {
          const here = i < present.length && present[i];
          if (!here && i < present.length && run < 0) run = i;
          if ((here || i === present.length) && run >= 0) {
            if (i - run >= minGap) gaps.push({ from: run, to: i - 1, toEnd: i === present.length });
            run = -1;
          }
        }
      }
      return { referenceId: c.id, name: c.name, perChapter, first, last, gaps };
    });
}

/** "Not seen since Ch. 4 (6 chapters)" lines for the review: characters who drop out for a long stretch. */
export function arcWarnings(arcs: readonly CharacterArc[], chapters: readonly ArcChapter[]): { referenceId: string; sceneId: string | null; message: string }[] {
  const out: { referenceId: string; sceneId: string | null; message: string }[] = [];
  for (const a of arcs) {
    // Someone mentioned once in passing isn't a character the reader is following.
    if (a.perChapter.filter((p) => p.mentions + p.lines > 0).length < 2) continue;
    for (const g of a.gaps) {
      const lastSeen = chapters[g.from - 1]?.title ?? '';
      const n = g.to - g.from + 1;
      out.push({
        referenceId: a.referenceId,
        sceneId: a.perChapter[g.from - 1]?.sceneId ?? null,
        message: g.toEnd ? `${a.name} hasn’t appeared since ${lastSeen} (${n} chapters).` : `${a.name} is missing for ${n} chapters after ${lastSeen}, until ${chapters[g.to + 1]?.title ?? 'later'}.`,
      });
    }
  }
  return out;
}
