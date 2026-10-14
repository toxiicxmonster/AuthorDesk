import { chat, type ChatOptions } from './aiEditor';
import { hashText } from '../domain/text';
import { sentencesOf } from '../review/metrics';

/**
 * AI scene and chapter summaries, for the Board and outlining. Built only from the text; shown to the author to use
 * or discard. A summary keeps a light fingerprint of the scene's sentences, so it can say when it's out of date.
 */

/** Short hashes of a text's sentences (at most 400), to tell later how much of it has changed. */
export function summaryBasis(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((p) => sentencesOf(p))
    .map((s) => hashText(s.toLowerCase().replace(/\s+/g, ' ').trim()).slice(0, 6))
    .slice(0, 400);
}

/** How much of the text is still what was summarized, 0–1 (1 when there's nothing to compare). */
export function summaryFreshness(text: string, basis: readonly string[] | undefined): number {
  if (!basis?.length) return 1;
  const now = summaryBasis(text);
  if (!now.length) return 0;
  const was = new Set(basis);
  const kept = now.filter((h) => was.has(h)).length;
  // Both ways: sentences added and sentences removed both make it stale.
  return Math.min(kept / now.length, kept / basis.length);
}

/** Below this share of unchanged sentences, a summary is flagged as possibly out of date. */
export const STALE_BELOW = 0.7;

const MAX_CHARS = 14_000;

export function sceneSummaryMessages(text: string) {
  const body = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[…the scene continues]` : text;
  return [
    {
      role: 'system' as const,
      content:
        'You write short synopses of scenes from a novel for the author’s outline. In 2 or 3 sentences, present tense: what happens and who is involved, in order. Use the characters’ names. No interpretation, themes, praise or advice, and nothing that isn’t in the scene. Reply with JSON: {"summary": "…"}, the summary as plain sentences.',
    },
    { role: 'user' as const, content: `Scene:\n"""${body}"""` },
  ];
}

export function chapterSummaryMessages(sceneSummaries: readonly string[]) {
  return [
    {
      role: 'system' as const,
      content: 'You write short chapter synopses for a novelist’s outline from the summaries of its scenes. In 2 to 4 sentences, present tense: what happens in the chapter, in order. Nothing that isn’t in the scene summaries. Reply with JSON: {"summary": "…"}, the summary as plain sentences.',
    },
    { role: 'user' as const, content: sceneSummaries.map((s, i) => `Scene ${i + 1}: ${s}`).join('\n') },
  ];
}

// One plain string: left to itself the model likes headings and bullet lists.
const SCHEMA = { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] };

/** The summary as plain prose: no Markdown, labels or list marks, whitespace tidied. */
export function plainSummary(answer: string): string {
  let t = answer;
  try {
    const j = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)) as { summary?: unknown };
    if (typeof j.summary === 'string') t = j.summary;
  } catch {
    /* not JSON: use the text as it is */
  }
  return t
    .replace(/^\s*(?:#+\s*)?(?:\*\*)?(?:scene|chapter)?\s*summary:?(?:\*\*)?:?\s*/i, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
}

export async function summarizeScene(text: string, opts: Pick<ChatOptions, 'signal' | 'fetchImpl'> = {}): Promise<string> {
  return plainSummary(await chat(sceneSummaryMessages(text), { ...opts, temperature: 0.2, maxTokens: 260, schema: SCHEMA }));
}

export async function summarizeChapter(sceneSummaries: readonly string[], opts: Pick<ChatOptions, 'signal' | 'fetchImpl'> = {}): Promise<string> {
  return plainSummary(await chat(chapterSummaryMessages(sceneSummaries), { ...opts, temperature: 0.2, maxTokens: 300, schema: SCHEMA }));
}
