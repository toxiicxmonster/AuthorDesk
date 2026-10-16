import { chat, type ChatOptions } from './aiEditor';
import type { PassItemDraft } from '../review/editPass';
import { PASS_KIND_LABELS } from '../review/editPass';
import { ruleLabel } from '../proofreading/rules';
import type { ChapterStats, ReviewReport } from '../review/metrics';

/**
 * "Explain the top issues in this chapter": the AI Editor reads what the checks found in a chapter (counted by
 * kind, with a few examples each) and how the chapter compares with the rest of the book, and explains the main
 * patterns in plain words, like an editor's note. It summarizes; it never rewrites the text.
 */

export interface IssueGroup {
  label: string;
  count: number;
  /** A real error (tense, grammar, spelling…) rather than a style choice. */
  error: boolean;
  examples: string[];
}

const EXAMPLES = 3;
const ERROR_KINDS = new Set(['spelling', 'grammar', 'punctuation', 'capitalization', 'confused', 'consistency', 'dialogue']);

/** The chapter's findings by kind (biggest first), each with a few example sentences. */
export function groupIssues(items: readonly PassItemDraft[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const it of items) {
    const label = it.ruleId === 'tense-shift' ? 'Tense slips' : it.kind === 'style' ? ruleLabel(it.ruleId) : (PASS_KIND_LABELS[it.kind] ?? it.kind);
    const g = groups.get(label) ?? { label, count: 0, error: ERROR_KINDS.has(it.kind), examples: [] };
    g.count++;
    const ex = `“${it.quote}” in: ${it.context.length > 220 ? `${it.context.slice(0, 220)}…` : it.context}`;
    if (g.examples.length < EXAMPLES && !g.examples.includes(ex)) g.examples.push(ex);
    groups.set(label, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** The patterns worth a note, most important first: real errors, then style patterns that come up three times or more. */
export function topGroups(groups: readonly IssueGroup[], max = 3): IssueGroup[] {
  const errors = groups.filter((g) => g.error).sort((a, b) => b.count - a.count);
  const style = groups.filter((g) => !g.error && g.count >= 3).sort((a, b) => b.count - a.count);
  return [...errors, ...style].slice(0, max);
}

/** Where the chapter stands out from the whole book (only clear differences). */
export function standOuts(ch: ChapterStats, overall: ReviewReport['overall']): string[] {
  const out: string[] = [];
  const more = (a: number, b: number) => b > 0 && a >= b * 1.5 && a - b >= 1;
  for (const [key, what] of [
    ['adverbs', 'adverbs'],
    ['filler', 'filler words'],
    ['passive', 'passive verbs'],
    ['echoes', 'echo words'],
    ['crutch', 'crutch words'],
  ] as const) {
    if (more(ch.per1k[key], overall.per1k[key])) out.push(`${what}: ${ch.per1k[key].toFixed(1)} per 1,000 words, against ${overall.per1k[key].toFixed(1)} across the book`);
  }
  if (ch.avgSentence >= overall.avgSentence * 1.3) out.push(`long sentences: ${ch.avgSentence.toFixed(0)} words on average, against ${overall.avgSentence.toFixed(0)}`);
  if (ch.sentenceSpread > 0 && ch.sentenceSpread < 4 && ch.sentences > 15) out.push('sentences of very similar length (a flat rhythm)');
  if (ch.dialogueShare < overall.dialogueShare * 0.5 && overall.dialogueShare > 0.15) out.push(`little dialogue: ${Math.round(ch.dialogueShare * 100)}% against ${Math.round(overall.dialogueShare * 100)}%`);
  return out;
}

export function chapterNotesMessages(title: string, top: readonly IssueGroup[], stand: readonly string[]) {
  const patterns = top.map((g, i) => `Pattern ${i + 1}: ${g.label}. Examples:\n${g.examples.map((e) => `    ${e}`).join('\n')}`);
  return [
    {
      role: 'system' as const,
      content: `You are a supportive fiction editor writing notes to an author about one chapter. For each pattern given, in the same order, write one note of two plain sentences addressed to the author as “you”: first what the pattern does to a reader in this chapter, then what to look for when revising. Don’t quote, paraphrase or rewrite the author’s sentences (the examples are shown to the author separately). No numbers or counts, no headings or labels, no praise. Reply with JSON: {"notes": [exactly ${top.length} strings]}.`,
    },
    {
      role: 'user' as const,
      content: [`Chapter: ${title}.`, patterns.join('\n\n'), stand.length ? `For context, compared with the rest of the book: ${stand.join('; ')}.` : ''].filter(Boolean).join('\n\n'),
    },
  ];
}

const schema = (n: number) => ({ type: 'object', properties: { notes: { type: 'array', items: { type: 'string' }, minItems: n, maxItems: n } }, required: ['notes'] });

export function parseNotes(answer: string): string[] {
  try {
    const j = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)) as { notes?: unknown };
    if (Array.isArray(j.notes)) return j.notes.filter((n): n is string => typeof n === 'string' && !!n.trim()).map((n) => n.replace(/\*\*([^*]+)\*\*/g, '$1').trim());
  } catch {
    /* fall through */
  }
  return answer
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean);
}

/** The sentence of the first finding in a group, word for word. */
function exampleOf(items: readonly PassItemDraft[], label: string): string | undefined {
  const it = items.find((x) => groupIssues([x])[0]?.label === label);
  if (!it) return undefined;
  return it.context.length > 220 ? `${it.context.slice(0, 220)}…` : it.context;
}

export interface ChapterNote {
  /** "Tense slips (6)", from the checks themselves, so the numbers are always right. */
  heading: string;
  text: string;
  /** One flagged sentence from the chapter, exactly as written. */
  example?: string;
}

export async function explainChapter(
  title: string,
  items: readonly PassItemDraft[],
  stats: ChapterStats | undefined,
  overall: ReviewReport['overall'],
  opts: Pick<ChatOptions, 'signal' | 'fetchImpl'> = {},
): Promise<ChapterNote[]> {
  const top = topGroups(groupIssues(items));
  const stand = stats ? standOuts(stats, overall) : [];
  const notes: ChapterNote[] = [];
  if (top.length) {
    const texts = parseNotes(await chat(chapterNotesMessages(title, top, stand), { ...opts, temperature: 0.3, maxTokens: 160 * top.length + 60, schema: schema(top.length) }));
    top.forEach((g, i) => notes.push({ heading: `${g.label} (${g.count})`, text: texts[i] ?? '', example: exampleOf(items, g.label) }));
  }
  // Where the chapter differs from the book is plain fact; no need for the model to phrase it.
  if (stand.length) {
    const t = `${stand.join('; ')}.`;
    notes.push({ heading: 'Compared with the rest of the book', text: t[0].toUpperCase() + t.slice(1) });
  }
  return notes;
}
