import { ADVERB_EXCEPTIONS } from '../proofreading/rules';
import { planPointCount } from '../domain/outlineNotes';
import { analyzeDialogue } from '../proofreading/dialogue';
import { GLUE } from '../proofreading/wordLists';
import { findEchoes } from '../proofreading/echo';

/**
 * Whole-manuscript review: statistics no scene-by-scene check can show. Most-used words and phrases, crutch words,
 * adverbs, passive voice, sticky sentences, readability, sentence variety, dialogue share and pacing, per chapter
 * and for the book. Pure and synchronous; the Review page runs it in a worker for long books.
 */

export interface SceneInput {
  sceneId: string;
  chapterId: string;
  chapterTitle: string;
  text: string;
}

/** A place in the manuscript to jump to, with what to look for when you get there. */
export interface Finding {
  sceneId: string;
  chapterTitle: string;
  /** Text to find in the scene (a distinctive stretch of the passage). */
  find: string;
  snippet: string;
  detail: string;
}

export type PaceKind = 'dialogue' | 'fast' | 'medium' | 'slow';

export interface ChapterStats {
  chapterId: string;
  title: string;
  words: number;
  sentences: number;
  avgSentence: number;
  /** Standard deviation of sentence length: low = monotonous rhythm. */
  sentenceSpread: number;
  readingEase: number;
  grade: number;
  dialogueShare: number;
  per1k: Record<'adverbs' | 'crutch' | 'passive' | 'filler' | 'tags' | 'echoes', number>;
  /** Words in each kind of stretch, in reading order (for the pacing bar). */
  pacing: { kind: PaceKind; words: number }[];
}

export interface ReviewReport {
  words: number;
  chapters: ChapterStats[];
  overall: Omit<ChapterStats, 'chapterId' | 'title' | 'pacing'>;
  topWords: { word: string; count: number; per10k: number; byChapter: number[]; first: Finding }[];
  topPhrases: { phrase: string; count: number; first: Finding }[];
  crutch: { word: string; count: number; per1k: number; byChapter: number[] }[];
  sticky: (Finding & { share: number })[];
  longest: Finding[];
  slowStretches: Finding[];
}

const CRUTCH = ['just', 'really', 'very', 'suddenly', 'actually', 'basically', 'quite', 'rather', 'somehow', 'simply', 'totally', 'literally', 'started to', 'began to', 'seemed to', 'felt like', 'in order to', 'managed to'];
const FILLER = /\b(?:very|really|just|quite|rather|somehow|basically|actually|totally|literally)\b/gi;
const PASSIVE = /\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ed|written|taken|given|seen|done|made|known|found|told|held|brought|thrown|driven|broken|chosen|forgotten|hidden|stolen|built|caught|left|lost|sent|shot|torn|worn)\b/gi;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const words = (s: string) => s.match(WORD) ?? [];

const PLAN_LINE = /^[-*•–]\s+\S/;

/**
 * The story paragraphs of a scene's text. Planning lines ("- Finn helps her clean up") are notes, not prose, so a
 * scene with two or more of them is measured without them (one dash-led line holding one point may be a dialogue dash).
 */
export function proseParagraphs(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && p !== '* * *');
  return planPointCount(paragraphs.filter((p) => PLAN_LINE.test(p))) >= 2 ? paragraphs.filter((p) => !PLAN_LINE.test(p)) : paragraphs;
}

/** Sentences of a paragraph (keeps quotes with their sentence). */
export function sentencesOf(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?…]["”’)\]]*)\s+(?=["“‘([]?[\p{Lu}\p{N}])/u)
    .map((s) => s.trim())
    .filter((s) => words(s).length > 0);
}

/** Rough English syllable count, good enough for readability scores. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

function readability(wordCount: number, sentenceCount: number, syllableCount: number) {
  if (!wordCount || !sentenceCount) return { readingEase: 0, grade: 0 };
  const wps = wordCount / sentenceCount;
  const spw = syllableCount / wordCount;
  return {
    readingEase: Math.max(0, Math.min(100, Math.round(206.835 - 1.015 * wps - 84.6 * spw))),
    grade: Math.round((0.39 * wps + 11.8 * spw - 15.59) * 10) / 10,
  };
}

/** A distinctive stretch of text to search for when jumping to a finding. */
const findText = (s: string) => (s.length <= 60 ? s : s.slice(0, 60).replace(/\s+\S*$/, ''));
const snip = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

const quoteWords = (p: string) => (p.match(/“[^”]*”|"[^"]*"/g) ?? []).reduce((n, q) => n + words(q).length, 0);

function paceOf(paragraph: string, sentences: string[]): PaceKind {
  const w = words(paragraph).length;
  if (w && (/^["“]/.test(paragraph) || quoteWords(paragraph) / w >= 0.4)) return 'dialogue';
  const avg = sentences.length ? w / sentences.length : w;
  return avg <= 12 ? 'fast' : avg <= 22 ? 'medium' : 'slow';
}

const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};
const round1 = (x: number) => Math.round(x * 10) / 10;

export function reviewManuscript(scenes: readonly SceneInput[], knownNames: readonly string[] = []): ReviewReport {
  const nameParts = new Set(knownNames.flatMap((n) => n.toLowerCase().split(/\s+/)));
  const chapterIds = [...new Set(scenes.map((s) => s.chapterId))];
  const chapterIndex = new Map(chapterIds.map((id, i) => [id, i]));

  interface Acc {
    words: number;
    sentences: number[];
    syll: number;
    adverbs: number;
    crutch: number;
    passive: number;
    filler: number;
    tags: number;
    echoes: number;
    spoken: number;
    pacing: { kind: PaceKind; words: number }[];
  }
  const blank = (): Acc => ({ words: 0, sentences: [], syll: 0, adverbs: 0, crutch: 0, passive: 0, filler: 0, tags: 0, echoes: 0, spoken: 0, pacing: [] });
  const acc = new Map<string, Acc>(chapterIds.map((id) => [id, blank()]));
  const titles = new Map(scenes.map((s) => [s.chapterId, s.chapterTitle]));

  const wordCounts = new Map<string, { count: number; byChapter: number[]; first: Finding }>();
  const phraseCounts = new Map<string, { count: number; first: Finding }>();
  const crutchCounts = new Map<string, number[]>(CRUTCH.map((c) => [c, chapterIds.map(() => 0)]));
  const sticky: (Finding & { share: number })[] = [];
  const longest: (Finding & { n: number })[] = [];
  const slowStretches: Finding[] = [];

  for (const scene of scenes) {
    const ci = chapterIndex.get(scene.chapterId)!;
    const a = acc.get(scene.chapterId)!;
    const paragraphs = proseParagraphs(scene.text);
    const dlg = analyzeDialogue(paragraphs, knownNames);
    a.tags += dlg.lines.filter((l) => l.tag).length;
    a.echoes += findEchoes(paragraphs, knownNames).length;
    let slowRun: string[] = [];
    let slowWords = 0;
    const flushSlow = () => {
      if (slowRun.length >= 3 || slowWords >= 300)
        slowStretches.push({ sceneId: scene.sceneId, chapterTitle: scene.chapterTitle, find: findText(slowRun[0]), snippet: snip(slowRun[0]), detail: `${slowRun.length} long-sentence paragraphs in a row (${slowWords} words) with little dialogue or action.` });
      slowRun = [];
      slowWords = 0;
    };

    for (const para of paragraphs) {
      const sents = sentencesOf(para);
      const pw = words(para).length;
      const kind = paceOf(para, sents);
      const last = a.pacing[a.pacing.length - 1];
      if (last && last.kind === kind) last.words += pw;
      else a.pacing.push({ kind, words: pw });
      if (kind === 'slow') {
        slowRun.push(para);
        slowWords += pw;
      } else flushSlow();
      a.spoken += quoteWords(para);

      for (const sent of sents) {
        const ws = words(sent);
        const n = ws.length;
        a.words += n;
        a.sentences.push(n);
        for (const w of ws) a.syll += syllables(w);
        const lower = ws.map((w) => w.toLowerCase().replace(/’/g, "'"));
        a.adverbs += lower.filter((w) => w.length >= 5 && w.endsWith('ly') && !ADVERB_EXCEPTIONS.has(w)).length;
        a.passive += (sent.match(PASSIVE) ?? []).length;
        a.filler += (sent.match(FILLER) ?? []).length;
        const here = (): Finding => ({ sceneId: scene.sceneId, chapterTitle: scene.chapterTitle, find: findText(sent), snippet: snip(sent), detail: '' });

        // Crutch words and phrases.
        const joined = ` ${lower.join(' ')} `;
        for (const c of CRUTCH) {
          const hits = joined.split(` ${c} `).length - 1;
          if (hits) {
            crutchCounts.get(c)![ci] += hits;
            a.crutch += hits;
          }
        }
        // Sticky sentences: mostly glue words. Plain short sentences are often mostly glue and read fine,
        // so only longer ones that are heavily glued are worth a look.
        if (n >= 12) {
          const glue = lower.filter((w) => GLUE.has(w)).length / n;
          if (glue >= 0.6) sticky.push({ ...here(), share: Math.round(glue * 100), detail: `${Math.round(glue * 100)}% glue words` });
        }
        if (n >= 30) longest.push({ ...here(), n, detail: `${n} words` });
        // Most-used content words.
        for (const w of lower) {
          if (w.length < 4 || GLUE.has(w) || nameParts.has(w) || /^\d/.test(w)) continue;
          let e = wordCounts.get(w);
          if (!e) wordCounts.set(w, (e = { count: 0, byChapter: chapterIds.map(() => 0), first: here() }));
          e.count++;
          e.byChapter[ci]++;
        }
        // Repeated 3- and 4-word phrases (not made only of glue words).
        for (const len of [3, 4]) {
          for (let i = 0; i + len <= lower.length; i++) {
            const gram = lower.slice(i, i + len);
            if (gram.every((w) => GLUE.has(w)) || gram.some((w) => nameParts.has(w))) continue;
            const phrase = gram.join(' ');
            const e = phraseCounts.get(phrase);
            if (e) e.count++;
            else phraseCounts.set(phrase, { count: 1, first: here() });
          }
        }
      }
    }
    flushSlow();
  }

  const statsOf = (a: Acc) => {
    const r = readability(a.words, a.sentences.length, a.syll);
    const k = a.words ? 1000 / a.words : 0;
    return {
      words: a.words,
      sentences: a.sentences.length,
      avgSentence: round1(a.sentences.length ? a.words / a.sentences.length : 0),
      sentenceSpread: round1(stdev(a.sentences)),
      ...r,
      dialogueShare: a.words ? Math.round((a.spoken / a.words) * 100) / 100 : 0,
      per1k: { adverbs: round1(a.adverbs * k), crutch: round1(a.crutch * k), passive: round1(a.passive * k), filler: round1(a.filler * k), tags: round1(a.tags * k), echoes: round1(a.echoes * k) },
    };
  };
  const chapters: ChapterStats[] = chapterIds.map((id) => ({ chapterId: id, title: titles.get(id) ?? '', ...statsOf(acc.get(id)!), pacing: acc.get(id)!.pacing }));
  const all = [...acc.values()].reduce((t, a) => {
    t.words += a.words;
    t.sentences.push(...a.sentences);
    t.syll += a.syll;
    t.adverbs += a.adverbs;
    t.crutch += a.crutch;
    t.passive += a.passive;
    t.filler += a.filler;
    t.tags += a.tags;
    t.echoes += a.echoes;
    t.spoken += a.spoken;
    return t;
  }, blank());
  const total = all.words;

  const topWords = [...wordCounts]
    .filter(([, e]) => e.count >= 5)
    .sort((x, y) => y[1].count - x[1].count)
    .slice(0, 30)
    .map(([word, e]) => ({ word, count: e.count, per10k: round1((e.count / Math.max(total, 1)) * 10_000), byChapter: e.byChapter, first: e.first }));

  // Drop a phrase when a longer phrase containing it repeats just as often.
  const repeated = [...phraseCounts].filter(([, e]) => e.count >= 3).sort((x, y) => y[1].count - x[1].count);
  const topPhrases = repeated
    .filter(([p, e]) => !repeated.some(([q, f]) => q !== p && q.includes(p) && f.count >= e.count))
    .slice(0, 20)
    .map(([phrase, e]) => ({ phrase, count: e.count, first: e.first }));

  return {
    words: total,
    chapters,
    overall: statsOf(all),
    topWords,
    topPhrases,
    crutch: [...crutchCounts]
      .map(([word, byChapter]) => {
        const count = byChapter.reduce((a, b) => a + b, 0);
        return { word, count, per1k: round1((count / Math.max(total, 1)) * 1000), byChapter };
      })
      .filter((c) => c.count > 0)
      .sort((x, y) => y.count - x.count),
    sticky: sticky.sort((x, y) => y.share - x.share).slice(0, 40),
    longest: longest.sort((x, y) => y.n - x.n).slice(0, 15).map(({ n: _n, ...f }) => f),
    slowStretches,
  };
}
