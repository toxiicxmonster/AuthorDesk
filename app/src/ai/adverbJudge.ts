import { chat, type ChatOptions } from './aiEditor';
import type { Suggestion } from '../proofreading/types';

/**
 * Lets the AI Editor read the sentence before an adverb is flagged. Rules flag every "-ly" word and intensifier;
 * the model keeps the ones that earn their place (meaning the verb can't carry, rhythm, a character's voice in
 * dialogue, "barely"/"almost"-type words that change meaning) and only the weak ones stay underlined.
 */

/** The rule checks the AI double-checks. */
export const AI_JUDGED_RULES = new Set(['adverb', 'filler-word', 'stronger-word']);

export interface AdverbItem {
  word: string;
  sentence: string;
  inDialogue: boolean;
}

export interface Verdict {
  keep: boolean;
  reason: string;
}

const verdicts = new Map<string, Verdict>();
const keyOf = (i: AdverbItem) => `${i.word.toLowerCase()}\u0001${i.sentence}`;

/** A verdict reached earlier for this word in this exact sentence, if any. */
export function cachedVerdict(i: AdverbItem): Verdict | undefined {
  return verdicts.get(keyOf(i));
}

/** For tests. */
export function resetAdverbVerdicts() {
  verdicts.clear();
}

/** The sentence around [start, end) in a paragraph, and whether that spot is inside quoted speech. */
export function sentenceAround(text: string, start: number, end: number): { sentence: string; inDialogue: boolean } {
  let a = start;
  while (a > 0 && !/[.!?…]["”’]?\s+$/.test(text.slice(Math.max(0, a - 4), a))) a--;
  let b = end;
  while (b < text.length && !/[.!?…]/.test(text[b])) b++;
  while (b < text.length && /[.!?…"”’]/.test(text[b])) b++;
  const before = text.slice(0, start);
  const opens = (before.match(/“/g) ?? []).length;
  const closes = (before.match(/”/g) ?? []).length;
  const straight = (before.match(/"/g) ?? []).length;
  return { sentence: text.slice(a, b).trim(), inDialogue: opens > closes || straight % 2 === 1 };
}

/** The word a judged suggestion is about: the adverb itself, or the adverb inside "ran quickly" / "very tired". */
export function judgedWord(s: Pick<Suggestion, 'original' | 'ruleId'>): string {
  if (s.ruleId !== 'stronger-word') return s.original.replace(/^[,\s]+|[,\s]+$/g, '').split(/[\s,]+/)[0];
  const parts = s.original.split(/\s+/);
  return parts.find((p) => /ly$/i.test(p) || /^(?:very|really|so|extremely|incredibly|terribly|awfully|super|truly|fast|hard)$/i.test(p)) ?? parts[parts.length - 1];
}

const SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, verdict: { type: 'string', enum: ['keep', 'cut'] }, reason: { type: 'string' } },
        required: ['id', 'verdict', 'reason'],
      },
    },
  },
  required: ['verdicts'],
};

const SYSTEM = `You are an experienced fiction editor judging adverbs and intensifiers in a novelist's draft.
For each item, decide whether the marked word earns its place.
- "keep" if it adds meaning the verb can't carry, changes the meaning (barely, almost, only, nearly, still), sets rhythm or voice, is part of a character's spoken dialogue, or cutting it would make the sentence worse.
- "cut" if it's redundant ("whispered softly"), props up a weak verb a stronger verb could replace ("ran quickly"), is an empty intensifier ("very", "really"), or tells what the sentence should show.
Many adverbs are fine: don't cut by habit, and don't keep by habit either. When you say "cut", suggest the stronger wording in the reason, and never suggest another adverb or intensifier as the replacement.
Examples:
- "He ran quickly to the door." quickly → cut: "sprinted" or "raced" says it in one word.
- "She could barely breathe." barely → keep: it changes the meaning.
- "'Go home,' she whispered softly." softly → cut: whispering is already soft.
- "'I really don't care,' Tom said." really → keep: it's how Tom talks.
- "The room was very dark." very → cut: try "pitch-dark" or "black".
- "He set the glass down deliberately, holding her gaze." deliberately → keep: it shows intent.
- "After ten years, she was finally home." finally → keep: it carries the relief.
- "She smiled happily." happily → cut: the smile already shows it.
Give each reason in under 15 words, addressed to the writer.`;

let queue: Promise<unknown> = Promise.resolve();

/**
 * Judges items not already judged (in batches), filling the cache. Requests run one at a time, so overlapping
 * checks of the same scene don't ask twice. Returns how many were judged.
 */
export function judgeAdverbs(items: AdverbItem[], opts: Pick<ChatOptions, 'signal' | 'fetchImpl'> = {}): Promise<number> {
  const run = queue.then(() => judgeNow(items, opts));
  queue = run.catch(() => undefined);
  return run;
}

async function judgeNow(items: AdverbItem[], opts: Pick<ChatOptions, 'signal' | 'fetchImpl'>): Promise<number> {
  const todo = [...new Map(items.filter((i) => !verdicts.has(keyOf(i))).map((i) => [keyOf(i), i])).values()];
  for (let k = 0; k < todo.length; k += 12) {
    const batch = todo.slice(k, k + 12);
    const list = batch.map((i, n) => `${n + 1}. Word: "${i.word}" · In dialogue: ${i.inDialogue ? 'yes' : 'no'} · Sentence: ${i.sentence}`).join('\n');
    const answer = await chat(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `${list}\n\nReply with JSON: {"verdicts":[{"id":1,"verdict":"keep"|"cut","reason":"…"}, …]} covering every item.` },
      ],
      { ...opts, temperature: 0.1, maxTokens: 60 * batch.length + 80, schema: SCHEMA },
    );
    let parsed: { verdicts?: { id?: number; verdict?: string; reason?: string }[] } = {};
    try {
      parsed = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1));
    } catch {
      /* unreadable answer: leave these unjudged */
    }
    for (const v of parsed.verdicts ?? []) {
      const item = batch[(v.id ?? 0) - 1];
      if (!item || (v.verdict !== 'keep' && v.verdict !== 'cut')) continue;
      let reason = (v.reason ?? '').trim();
      // A reason that recommends another adverb ("try 'hurriedly'") is worse than none: drop it, keep the verdict.
      if (/["'“‘]\s*[a-z]+ly\b/i.test(reason)) reason = '';
      verdicts.set(keyOf(item), { keep: v.verdict === 'keep', reason });
    }
  }
  return todo.length;
}
