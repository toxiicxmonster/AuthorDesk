import type { ReferenceEntry } from '../domain/schema';

/**
 * Who "he" and "she" are in speech tags ("he snapped", "She sighed. “Fine.”"). A character's pronoun is learned from
 * the book itself (the pronouns that follow their name: "Jace snapped, while his eyes…"), never guessed from the
 * name. A "he" line then belongs to the most recently mentioned character with that pronoun, looking back a few
 * paragraphs; names inside dialogue (people being spoken to) don't count. Pure.
 */

export type Pronoun = 'he' | 'she';

type Char = Pick<ReferenceEntry, 'id' | 'name' | 'aliases'>;

const MALE = /^(?:he|him|his|himself)$/i;
const FEMALE = /^(?:she|her|hers|herself)$/i;
/** How far back (in paragraphs) a mention can explain a pronoun. */
export const LOOKBACK = 6;

/** Dialogue (and outline notes) blanked out, same length, so only narration is searched for names. */
export function narrationOnly(text: string): string {
  if (/^\s*[-*•–]\s/.test(text)) return ' '.repeat(text.length); // an outline note, not prose
  return text.replace(/["“][^"”]*(?:["”]|$)/g, (q) => ' '.repeat(q.length));
}

/** The names a character goes by in the text: full name, nicknames, and the first word of the full name. */
function namesOf(c: Char): string[] {
  const first = c.name.trim().split(/\s+/)[0];
  return [...new Set([c.name, ...c.aliases, first].map((n) => n.trim()).filter((n) => n.length > 1))].sort((a, b) => b.length - a.length);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Mention {
  id: string;
  block: number;
  at: number;
  end: number;
}

/** Every mention of a listed character in the narration, in reading order. */
export function mentions(paragraphs: readonly string[], chars: readonly Char[]): Mention[] {
  const out: Mention[] = [];
  const all = chars.flatMap((c) => namesOf(c).map((n) => ({ id: c.id, n })));
  if (!all.length) return out;
  const re = new RegExp(`(?<![\\p{L}])(${all.map((x) => escape(x.n)).join('|')})(?![\\p{L}])`, 'gu');
  paragraphs.forEach((p, block) => {
    const text = narrationOnly(p);
    for (const m of text.matchAll(re)) {
      const who = all.find((x) => x.n === m[1]);
      if (who) out.push({ id: who.id, block, at: m.index!, end: m.index! + m[0].length });
    }
  });
  return out;
}

/** Each character's pronoun, from the pronouns that follow their name in the same sentence (at least twice, and twice as often as the other). */
export function learnPronouns(paragraphs: readonly string[], chars: readonly Char[]): Map<string, Pronoun> {
  const counts = new Map<string, { he: number; she: number }>();
  const ms = mentions(paragraphs, chars);
  ms.forEach((m, i) => {
    const text = narrationOnly(paragraphs[m.block]);
    const next = ms[i + 1];
    // Up to the end of the sentence, or the next character's name, whichever comes first.
    let stop = text.slice(m.end).search(/[.!?…]/);
    stop = stop < 0 ? text.length : m.end + stop;
    if (next && next.block === m.block && next.at < stop) stop = next.at;
    const c = counts.get(m.id) ?? { he: 0, she: 0 };
    for (const w of text.slice(m.end, stop).match(/\p{L}+/gu) ?? []) {
      if (MALE.test(w)) c.he++;
      else if (FEMALE.test(w)) c.she++;
    }
    counts.set(m.id, c);
  });
  const out = new Map<string, Pronoun>();
  for (const [id, c] of counts) {
    // "her" after a name is often someone else ("Jace didn't agree with her"), so ask for a clear lead, not unanimity.
    const [win, lose] = c.he > c.she ? [c.he, c.she] : [c.she, c.he];
    if (win >= 2 && win >= 2 * lose) out.set(id, c.he > c.she ? 'he' : 'she');
  }
  return out;
}

/**
 * The character a "he"/"she" speech tag at (block, at) refers to: the latest earlier mention, within LOOKBACK
 * paragraphs, of someone with that pronoun. Null when nobody fits or the pronoun isn't he/she.
 */
export function resolvePronoun(pronoun: string, block: number, at: number, ms: readonly Mention[], pronouns: ReadonlyMap<string, Pronoun>): string | null {
  const p = pronoun.toLowerCase();
  if (p !== 'he' && p !== 'she') return null;
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i];
    if (m.block > block || (m.block === block && m.at >= at)) continue;
    if (block - m.block > LOOKBACK) break;
    if (pronouns.get(m.id) === p) return m.id;
  }
  return null;
}
