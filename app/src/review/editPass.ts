import type { Revision, RevisionStatus } from '../domain/schema';
import { checkBlocks } from '../proofreading/providers';
import { knownNameSpans, protectNames } from '../proofreading/names';
import { avoidEchoes, findEchoes } from '../proofreading/echo';
import { synonymsFor } from '../proofreading/synonyms';
import { findHardSentences, hardSentenceMessage } from '../proofreading/hardSentence';
import { findTenseSlips, tenseSlipMessage } from '../proofreading/tense';
import { sentenceAround } from '../ai/adverbJudge';
import { CATEGORY_LABELS, type Category, type ProofreadContext } from '../proofreading/types';
import { reviewManuscript } from './metrics';

/**
 * Edit passes: every suggestion and review finding for a chapter or the book, as a checklist to work through like
 * an editor's notes. Items are anchored by their words and sentence, so they're found again after edits. Nothing
 * here changes the manuscript.
 */

export interface PassScene {
  sceneId: string;
  chapterId: string;
  chapterTitle: string;
  paragraphs: string[];
}

export type PassItemDraft = Pick<Revision, 'sceneId' | 'chapterId' | 'order' | 'quote' | 'context' | 'kind' | 'ruleId' | 'message' | 'replacements'>;

/** Labels for the kinds of item, for filters and the report. */
export const PASS_KIND_LABELS: Record<string, string> = {
  ...CATEGORY_LABELS,
  echo: 'Echo words',
  hard: 'Hard to read',
  sticky: 'Sticky sentences',
  slow: 'Slow stretches',
};

/**
 * Collects the items for a pass, in reading order: the on-device checks' fixes (as in the editor), echo words, hard
 * sentences (when the AI Editor can rewrite them), and the review's sticky sentences and slow stretches.
 * `skip(ruleId, original, context)` leaves out suggestions the author already ignored.
 */
export async function collectPassItems(
  scenes: readonly PassScene[],
  ctx: ProofreadContext,
  opts: { aiInstalled: boolean; skip?: (ruleId: string, original: string, context: string) => boolean },
): Promise<PassItemDraft[]> {
  const out: PassItemDraft[] = [];
  const skip = opts.skip ?? (() => false);
  const add = (s: PassScene, para: string, start: number, end: number, item: Omit<PassItemDraft, 'sceneId' | 'chapterId' | 'order' | 'quote' | 'context'>) => {
    const quote = para.slice(start, end);
    if (skip(item.ruleId, quote, para.slice(Math.max(0, start - 20), end + 20))) return;
    const context = sentenceAround(para, start, end).sentence || para;
    out.push({ sceneId: s.sceneId, chapterId: s.chapterId, order: out.length, quote, context, ...item });
  };
  for (const s of scenes) {
    const { results } = await checkBlocks(s.paragraphs, ctx);
    const echoes = ctx.disabledRules.has('echo-word') || ctx.disabledCategories.has('repetition') ? [] : findEchoes(s.paragraphs, ctx.knownNames);
    const slips = ctx.disabledRules.has('tense-shift') || ctx.disabledCategories.has('grammar') ? [] : findTenseSlips(s.paragraphs, ctx.knownNames);
    s.paragraphs.forEach((para, bi) => {
      const fixes = protectNames(para, results[bi] ?? [], knownNameSpans(para, ctx.knownNames)).filter((x) => x.replacements.length > 0);
      for (const x of fixes) add(s, para, x.start, x.end, { kind: x.category, ruleId: x.ruleId, message: x.message, replacements: x.replacements });
      for (const e of echoes.filter((e) => e.block === bi)) {
        const near = s.paragraphs.slice(Math.max(0, bi - 1), bi + 2).join(' ');
        const replacements = avoidEchoes(e.word, synonymsFor(e.word), near);
        if (!replacements.length && !opts.aiInstalled) continue;
        add(s, para, e.start, e.end, { kind: 'echo', ruleId: 'echo-word', message: `“${e.word}” was also used ${e.distance} words earlier.`, replacements });
      }
      for (const t of slips.filter((t) => t.block === bi)) {
        add(s, para, t.start, t.end, { kind: 'grammar', ruleId: 'tense-shift', message: tenseSlipMessage(t), replacements: t.replacement ? [t.replacement] : [] });
      }
      if (opts.aiInstalled && !ctx.disabledRules.has('hard-sentence') && !ctx.disabledCategories.has('clarity' as Category)) {
        for (const h of findHardSentences(para)) add(s, para, h.start, h.end, { kind: 'hard', ruleId: 'hard-sentence', message: hardSentenceMessage(h), replacements: [] });
      }
    });
  }
  // Findings only the whole text shows.
  const report = reviewManuscript(scenes.map((s) => ({ sceneId: s.sceneId, chapterId: s.chapterId, chapterTitle: s.chapterTitle, text: s.paragraphs.join('\n\n') })), ctx.knownNames);
  const chapterOf = new Map(scenes.map((s) => [s.sceneId, s.chapterId]));
  // Sticky sentences have no fix of their own: only with the AI Editor, which can offer a tighter version.
  const findings = [
    ...(opts.aiInstalled ? report.sticky.map((f) => ({ f, kind: 'sticky', message: `Sticky sentence: ${f.detail}. Mostly little glue words; a tighter version reads faster.` })) : []),
    ...report.slowStretches.map((f) => ({ f, kind: 'slow', message: `Slow stretch: ${f.detail}.` })),
  ];
  for (const { f, kind, message } of findings) {
    if (/^\s*[-*•–]\s/.test(f.find)) continue; // outline notes aren't prose
    out.push({ sceneId: f.sceneId, chapterId: chapterOf.get(f.sceneId) ?? null, order: out.length, quote: f.find, context: f.snippet, kind, ruleId: kind, message, replacements: [] });
  }
  // Reading order: by scene, then by where the words are in it.
  const sceneIndex = new Map(scenes.map((s, i) => [s.sceneId, i]));
  const textOf = new Map(scenes.map((s) => [s.sceneId, s.paragraphs.join('\n\n')]));
  const where = (it: PassItemDraft) => {
    const t = textOf.get(it.sceneId) ?? '';
    const at = t.indexOf(it.context);
    return at >= 0 ? at + Math.max(0, it.context.indexOf(it.quote)) : t.indexOf(it.quote);
  };
  return out
    .sort((a, b) => (sceneIndex.get(a.sceneId) ?? 0) - (sceneIndex.get(b.sceneId) ?? 0) || where(a) - where(b))
    .map((it, i) => ({ ...it, order: i }));
}

/**
 * Where an item is in its scene's current text, or null if the words are gone (it was rewritten: count it as done).
 * Looks for its sentence first, then just its words.
 */
export function locateItem(text: string, item: Pick<Revision, 'quote' | 'context'>): { start: number; end: number } | null {
  const inContext = item.context ? text.indexOf(item.context) : -1;
  if (inContext >= 0) {
    const off = item.context.indexOf(item.quote);
    if (off >= 0) return { start: inContext + off, end: inContext + off + item.quote.length };
  }
  // The sentence changed: the words alone still count only if they appear exactly once.
  const first = text.indexOf(item.quote);
  if (first < 0 || text.indexOf(item.quote, first + 1) >= 0) return null;
  return { start: first, end: first + item.quote.length };
}

export interface PassProgress {
  total: number;
  done: number;
  open: number;
  later: number;
}

export function passProgress(items: readonly Pick<Revision, 'status'>[], gone: ReadonlySet<string> = new Set(), ids: readonly string[] = []): PassProgress {
  let done = 0;
  let open = 0;
  let later = 0;
  items.forEach((it, i) => {
    const st: RevisionStatus = gone.has(ids[i] ?? '') && it.status === 'open' ? 'done' : it.status;
    if (st === 'done' || st === 'dismissed') done++;
    else if (st === 'later') later++;
    else open++;
  });
  return { total: items.length, done, open, later };
}

const STATUS_MARK: Record<RevisionStatus, string> = { open: '[ ]', done: '[x]', dismissed: '[x] (dismissed)', later: '[ ] (later)' };

/** The pass as a Markdown report, by chapter: for a human editor or beta reader, or to keep. */
export function passReport(passName: string, items: readonly Revision[], chapterTitles: ReadonlyMap<string, string>): string {
  const lines = [`# ${passName}`, ''];
  const p = passProgress(items);
  lines.push(`${p.done} of ${p.total} done${p.later ? `, ${p.later} for later` : ''}.`, '');
  let chapter: string | null | undefined;
  for (const it of [...items].sort((a, b) => a.order - b.order)) {
    if (it.chapterId !== chapter) {
      chapter = it.chapterId;
      lines.push(`## ${(it.chapterId && chapterTitles.get(it.chapterId)) || 'Chapter'}`, '');
    }
    const fix = it.replacements.filter(Boolean).length ? ` Suggested: ${it.replacements.filter(Boolean).slice(0, 3).map((r) => `“${r}”`).join(', ')}.` : '';
    lines.push(`- ${STATUS_MARK[it.status]} **${PASS_KIND_LABELS[it.kind] ?? it.kind}**: “${it.quote.length > 120 ? it.quote.slice(0, 117) + '…' : it.quote}”. ${it.message}${fix}`);
    if (it.note.trim()) lines.push(`  - Note: ${it.note.trim()}`);
  }
  return lines.join('\n') + '\n';
}
