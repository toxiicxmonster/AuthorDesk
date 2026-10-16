import { analyzeDialogue } from '../proofreading/dialogue';
import type { ContinuityScene } from '../proofreading/continuity';
import type { ReferenceEntry } from '../domain/schema';
import { GLUE } from '../proofreading/wordLists';
import { learnPronouns, mentions, resolvePronoun } from '../proofreading/speakers';

/**
 * Character voices: who talks, how much, and what makes each of them sound like themselves. From the dialogue lines
 * the dialogue assistant attributes (speech tags and action beats); unattributed lines aren't counted. Pure.
 */

export interface Voice {
  referenceId: string;
  name: string;
  lines: number;
  /** Words spoken. */
  words: number;
  /** Share of all attributed dialogue words, 0–1. */
  share: number;
  /** Average words per line. */
  perLine: number;
  /** Their most used speech verbs, most first ("said", "snapped"). */
  tags: [string, number][];
  /** Words they use much more than everyone else does. */
  signature: string[];
  /** A short line of theirs, and where it is. */
  sample: { sceneId: string; text: string } | null;
  /** Chapters (positions in reading order) where they speak. */
  chapters: number[];
}

const WORD = /[\p{L}][\p{L}'’-]*/gu;
const spoken = (quote: string) => quote.replace(/^["“'‘]|["”'’]$/g, '');

export function characterVoices(scenes: readonly (ContinuityScene & { chapterIndex: number; povId?: string | null })[], characters: readonly ReferenceEntry[], knownNames: readonly string[]): Voice[] {
  const chars = characters.filter((c) => !c.archivedAt && c.type === 'character');
  const byName = new Map<string, ReferenceEntry>();
  for (const c of chars) for (const n of [c.name, ...c.aliases]) if (n.trim()) byName.set(n.trim().toLowerCase(), c);
  const nameWords = new Set(chars.flatMap((c) => [c.name, ...c.aliases]).flatMap((n) => n.toLowerCase().split(/\s+/)));

  interface Acc {
    lines: number;
    words: number;
    tags: Map<string, number>;
    vocab: Map<string, number>;
    sample: { sceneId: string; text: string } | null;
    chapters: Set<number>;
  }
  const acc = new Map<string, Acc>();
  const all = new Map<string, number>();
  let allWords = 0;
  // Pronouns are learned from the whole book: one scene rarely says enough.
  const pronouns = learnPronouns(
    scenes.flatMap((s) => s.paragraphs),
    chars,
  );
  for (const s of scenes) {
    const ms = mentions(s.paragraphs, chars);
    for (const l of analyzeDialogue(s.paragraphs, knownNames).lines) {
      // In a first-person scene, "I" is the point-of-view character; "he" and "she" are whoever was last mentioned.
      const byPronoun = l.speaker ? resolvePronoun(l.speaker, l.block, l.start, ms, pronouns) : null;
      const c =
        l.speaker === 'I'
          ? chars.find((x) => x.id === s.povId)
          : byPronoun
            ? chars.find((x) => x.id === byPronoun)
            : l.speaker
              ? byName.get(l.speaker.toLowerCase())
              : undefined;
      if (!c) continue;
      const a = acc.get(c.id) ?? { lines: 0, words: 0, tags: new Map(), vocab: new Map(), sample: null, chapters: new Set() };
      const words = spoken(l.text).match(WORD) ?? [];
      a.lines++;
      a.words += words.length;
      allWords += words.length;
      a.chapters.add(s.chapterIndex);
      if (l.tag) a.tags.set(l.tag, (a.tags.get(l.tag) ?? 0) + 1);
      for (const w of words) {
        const k = w.toLowerCase().replace(/['’]s$/, '');
        if (k.length < 3 || GLUE.has(k) || nameWords.has(k)) continue;
        a.vocab.set(k, (a.vocab.get(k) ?? 0) + 1);
        all.set(k, (all.get(k) ?? 0) + 1);
      }
      // The sample: a mid-length line says more about a voice than "No." or a speech.
      if (words.length >= 5 && words.length <= 25 && (!a.sample || Math.abs(words.length - 12) < Math.abs((a.sample.text.match(WORD)?.length ?? 0) - 12)))
        a.sample = { sceneId: s.sceneId, text: l.text };
      acc.set(c.id, a);
    }
  }
  const allVocab = [...all.values()].reduce((n, v) => n + v, 0);
  return chars
    .filter((c) => acc.has(c.id))
    .map((c) => {
      const a = acc.get(c.id)!;
      const mine = [...a.vocab.values()].reduce((n, v) => n + v, 0);
      // How much more often they use a word than everyone else does (smoothed), for words they use at least twice.
      const signature = [...a.vocab.entries()]
        .filter(([, n]) => n >= 2)
        .map(([w, n]) => [w, n / mine / ((all.get(w)! - n + 1) / (allVocab - mine + 1))] as const)
        .filter(([, score]) => score >= 2)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5)
        .map(([w]) => w);
      return {
        referenceId: c.id,
        name: c.name,
        lines: a.lines,
        words: a.words,
        share: allWords ? a.words / allWords : 0,
        perLine: a.lines ? Math.round((a.words / a.lines) * 10) / 10 : 0,
        tags: [...a.tags.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3),
        signature,
        sample: a.sample,
        chapters: [...a.chapters].sort((x, y) => x - y),
      };
    })
    .sort((x, y) => y.words - x.words);
}
