import { sentencesOf } from './metrics';

/**
 * The scene's rhythm for the pacing strip: one tick per sentence, top to bottom, sized by its length, marked as
 * dialogue or narration, with long sentences and long paragraphs picked out.
 */

export interface PacingBlock {
  /** The paragraph's text, with each inline leaf (a line break, an image) as one character so offsets map to positions. */
  text: string;
  /** Document position where the text starts. */
  pos: number;
}

export interface PacingTick {
  /** Document position of the sentence's first character. */
  pos: number;
  words: number;
  /** Characters, which sets the tick's share of the strip's height. */
  chars: number;
  dialogue: boolean;
  /** 30 words or more. */
  long: boolean;
  /** Part of a paragraph of 150 words or more. */
  longParagraph: boolean;
  /** First sentence of its paragraph (a small gap goes above it). */
  paragraphStart: boolean;
}

export const LONG_SENTENCE = 30;
export const LONG_PARAGRAPH = 150;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const countWords = (s: string) => (s.match(WORD) ?? []).length;
const QUOTE = /["“”]/;

export function pacingTicks(blocks: PacingBlock[]): PacingTick[] {
  const out: PacingTick[] = [];
  for (const b of blocks) {
    // A planning line ("- Finn helps her clean up") isn't part of the story's rhythm. (Dialogue dashes are – or —.)
    if (/^\s*[-*•]\s+\S/.test(b.text)) continue;
    const sentences = sentencesOf(b.text);
    if (!sentences.length) continue;
    const longParagraph = countWords(b.text) >= LONG_PARAGRAPH;
    let from = 0;
    sentences.forEach((s, i) => {
      const at = b.text.indexOf(s, from);
      const offset = at >= 0 ? at : from;
      from = offset + s.length;
      const words = countWords(s);
      out.push({ pos: b.pos + offset, words, chars: s.length, dialogue: QUOTE.test(s), long: words >= LONG_SENTENCE, longParagraph, paragraphStart: i === 0 });
    });
  }
  return out;
}

export interface PacingSummary {
  sentences: number;
  /** Share of sentences with dialogue, 0–1. */
  dialogue: number;
  averageWords: number;
  long: number;
}

export function pacingSummary(ticks: PacingTick[]): PacingSummary {
  const n = ticks.length;
  const words = ticks.reduce((a, t) => a + t.words, 0);
  return { sentences: n, dialogue: n ? ticks.filter((t) => t.dialogue).length / n : 0, averageWords: n ? Math.round(words / n) : 0, long: ticks.filter((t) => t.long).length };
}

/** The tick a click at `fraction` (0 = top, 1 = bottom) of the strip lands on, by the same layout the strip draws. */
export function tickAt(ticks: PacingTick[], fraction: number, gap: number): number {
  const total = ticks.reduce((a, t) => a + t.chars + (t.paragraphStart ? gap : 0), 0);
  let y = 0;
  const target = fraction * total;
  for (let i = 0; i < ticks.length; i++) {
    y += (ticks[i].paragraphStart ? gap : 0) + ticks[i].chars;
    if (y >= target) return i;
  }
  return ticks.length - 1;
}
