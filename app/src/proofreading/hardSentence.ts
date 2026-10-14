import { syllables } from '../review/metrics';

/**
 * "Hard to read" sentences: long ones built from several clauses, or ones whose reading grade is very high (long
 * words, long sentence). Their fix is the AI Editor's "Clearer" rewrite, so they're only shown when it's installed.
 * Pure.
 */

export interface HardSentence {
  start: number;
  end: number;
  words: number;
  clauses: number;
  /** Flesch–Kincaid grade of the sentence on its own. */
  grade: number;
}

/** At least this many words and clause breaks makes a sentence hard to follow. */
export const HARD_WORDS = 30;
export const HARD_CLAUSES = 3;
/** Or a reading grade this high, in a sentence of at least HARD_GRADE_WORDS words. */
export const HARD_GRADE = 14;
const HARD_GRADE_WORDS = 20;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
// Joining words that start a new clause.
const JOINERS = /\b(?:and|but|or|so|yet|which|who|whom|whose|because|while|although|though|whereas|until|unless|since|if|when|whenever|where|after|before)\b/gi;

/** Each sentence of a paragraph with its offsets. */
export function sentenceSpans(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = /[^.!?…]+(?:[.!?…]+["”’)\]]*|$)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    const lead = m[0].length - m[0].trimStart().length;
    const body = m[0].trim();
    if (body) out.push({ start: m.index + lead, end: m.index + lead + body.length });
  }
  return out;
}

export function findHardSentences(text: string): HardSentence[] {
  const out: HardSentence[] = [];
  // Outline notes and lists ("- Finn catches a glimpse…") aren't prose.
  if (/^\s*[-*•–]\s/.test(text)) return out;
  for (const { start, end } of sentenceSpans(text)) {
    const s = text.slice(start, end);
    const ws = s.match(WORD) ?? [];
    if (ws.length < HARD_GRADE_WORDS) continue;
    const syll = ws.reduce((n, w) => n + syllables(w), 0);
    const grade = 0.39 * ws.length + 11.8 * (syll / ws.length) - 15.59;
    // Clause breaks: commas, semicolons, colons and dashes, plus joining words not right after one of those.
    const marks = (s.match(/[,;:—–]|\s-\s/g) ?? []).length;
    const joiners = (s.replace(/[,;:—–]\s*\w+/g, '').match(JOINERS) ?? []).length;
    const clauses = marks + joiners;
    if ((ws.length >= HARD_WORDS && clauses >= HARD_CLAUSES) || grade >= HARD_GRADE) {
      out.push({ start, end, words: ws.length, clauses, grade: Math.round(grade) });
    }
  }
  return out;
}

export function hardSentenceMessage(h: HardSentence): string {
  const why = h.words >= HARD_WORDS && h.clauses >= HARD_CLAUSES ? `${h.words} words in ${h.clauses + 1} parts` : `reading grade ${h.grade}`;
  return `This sentence may be hard to follow (${why}). The AI Editor can suggest a clearer version.`;
}
