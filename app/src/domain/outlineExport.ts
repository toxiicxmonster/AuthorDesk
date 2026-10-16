import type { Chapter, ReferenceEntry, Scene } from './schema';
import { inlinePoints, planLines, type PlanLine } from './planChecklist';
import { outlineLines } from './outlineNotes';

/**
 * The book's plan as a document to read or print: each chapter's summary and plan, then each scene's summary, point
 * of view, place, time and plan, with ticked points marked. Pure; the Word file is built from this.
 */

export interface OutlineScene {
  title: string;
  /** "POV: Winnie Hartley · Place: The Book Shop · Time: day 1 7:32 P.M. · 1,098 words · Drafting" */
  details: string;
  summary: PlanLine[];
  notes: PlanLine[];
  /** Planning lines still typed in the scene's text. */
  inText: PlanLine[];
}

export interface OutlineChapter {
  title: string;
  words: number;
  summary: PlanLine[];
  /** Empty when the chapter has nothing to show yet (no text, summaries, notes or details). */
  scenes: OutlineScene[];
}

export interface Outline {
  chapters: OutlineChapter[];
  /** Plan points across the book, and how many are ticked off. */
  points: number;
  done: number;
}

export function buildOutline(chapters: readonly { chapter: Chapter; scenes: readonly Scene[] }[], refs: readonly ReferenceEntry[]): Outline {
  const name = (id: string | null | undefined) => (id ? refs.find((r) => r.id === id)?.name : undefined);
  let points = 0;
  let done = 0;
  const count = (lines: PlanLine[]) => {
    for (const l of lines)
      if (l.kind === 'point') {
        points++;
        if (l.done) done++;
      }
    return lines;
  };
  const key = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const out = chapters.map(({ chapter, scenes }, i): OutlineChapter => {
    const chapterPlan = planLines(chapter.summary);
    const outScenes = scenes.map((s) => {
      // Plan lines left in the text, a point each, without the ones already listed in the chapter's or scene's plan.
      const listed = new Set([...chapterPlan, ...planLines(s.summary), ...planLines(s.notes)].filter((l) => l.kind === 'point').map((l) => key(l.text)));
      const inText = outlineLines(s.content)
        .flatMap((l) => inlinePoints(l.replace(/^\s*[-*•–]\s+/, '')))
        .filter((t) => !listed.has(key(t)))
        .map((text): PlanLine => ({ kind: 'point', text, done: false }));
      const pov = name(s.povCharacterId);
      const place = name(s.locationId);
      const time = s.timeMarker.trim();
      const details = [pov && `POV: ${pov}`, place && `Place: ${place}`, time && `Time: ${time}`, `${s.wordCount.toLocaleString('en-US')} words`, s.status[0].toUpperCase() + s.status.slice(1)]
        .filter(Boolean)
        .join(' · ');
      const scene: OutlineScene = {
        title: s.title.trim() || 'Untitled scene',
        details,
        summary: count(planLines(s.summary)),
        notes: count(planLines(s.notes)),
        inText: count(inText),
      };
      const empty = !s.wordCount && !pov && !place && !time && !scene.summary.length && !scene.notes.length;
      return empty ? null : scene;
    });
    return {
      title: chapter.title.trim() || `Chapter ${i + 1}`,
      words: scenes.reduce((n, s) => n + s.wordCount, 0),
      summary: count(chapterPlan),
      scenes: outScenes.filter((s): s is OutlineScene => s !== null),
    };
  });
  return { chapters: out, points, done };
}
