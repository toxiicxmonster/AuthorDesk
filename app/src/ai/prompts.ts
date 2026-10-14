import type { ChatMessage } from './aiEditor';
import { stem } from '../proofreading/echo';

/** A listed character, as read-only context for the model. */
export interface CharacterContext {
  name: string;
  aliases: string[];
  /** Reference fields by label ("Personality and temperament" → "…"); empty ones left out. */
  notes: Record<string, string>;
}

export type AiTaskId = 'rewrite' | 'smoother' | 'tighter' | 'no-adverb' | 'no-repeat' | 'clearer' | 'grammar' | 'tone' | 'show' | 'voice' | 'ask';

export interface AiTask {
  id: AiTaskId;
  label: string;
  hint: string;
  /** How many alternatives to show (1 = a single answer). */
  versions: number;
  /** How many to ask the model for, when more than shown (the best are kept; see pickBest). */
  request?: number;
}

export const AI_TASKS: AiTask[] = [
  { id: 'rewrite', label: 'Rewrite', hint: 'Three different ways to say it', versions: 3 },
  { id: 'smoother', label: 'Smoother', hint: 'Better flow and rhythm', versions: 2 },
  { id: 'tighter', label: 'Tighter', hint: 'Cut wordiness, keep the meaning', versions: 2 },
  { id: 'no-adverb', label: 'Without the adverb', hint: 'Let a stronger verb or image carry it', versions: 3, request: 5 },
  { id: 'no-repeat', label: 'Without the echo', hint: 'Say it without repeating the word', versions: 3, request: 5 },
  { id: 'clearer', label: 'Clearer', hint: 'Untangle long or ambiguous sentences', versions: 2 },
  { id: 'grammar', label: 'Fix grammar', hint: 'Minimal corrections only', versions: 1 },
  { id: 'tone', label: 'Change tone', hint: 'More formal, casual, warmer, colder or tense', versions: 2 },
  { id: 'show', label: 'Show, don’t tell', hint: 'A concrete, sensory alternative', versions: 2 },
  { id: 'voice', label: 'Character voice', hint: 'Make a line sound like a chosen character', versions: 3 },
  { id: 'ask', label: 'Ask', hint: 'Ask anything about the passage', versions: 1 },
];

export const TONES = ['more formal', 'more casual', 'warmer', 'colder', 'more tense', 'more playful'] as const;

const EDITOR_BRIEF = `You are a careful line editor helping a novelist. Rules:
- Keep the author's voice, tense, point of view, meaning and every fact.
- Never add anything that isn't in the passage: no new actions, feelings, sensations, thoughts, body language, people, places or dialogue.
- Keep every name and pronoun as written: never replace "she" with a name or a name with "she".
- The character notes are background only. Don't put details from them into the passage.
- British or American spelling: match the passage.
- Answer with the edited text only. No introductions, explanations or quotation marks around your answer, unless asked.`;

const INSTRUCTIONS: Record<Exclude<AiTaskId, 'ask'> | 'no-repeat-all', string> = {
  rewrite: 'Rewrite the passage in {n} clearly different ways (different sentence shapes or word choices), each as good as or better than the original.',
  smoother: 'Rewrite the passage {n} ways so it reads more smoothly: vary sentence length and rhythm, fix awkward joins and repetition. Change as little as needed.',
  tighter: 'Rewrite the passage {n} ways, about 20–30% shorter: cut filler, redundancy and weak qualifiers while keeping every meaningful detail.',
  'no-adverb':
    'Rewrite the passage {n} ways with no adverbs ending in -ly and no intensifiers (very, really, so, quite, just). Carry the same meaning with precise verbs and concrete wording instead: "walked slowly" → "crept", "very quietly opened it" → "eased it open", "quickly slipped outside" → "slipped outside". Words that change the meaning, like "barely" or "almost", may stay. Check each version: if it still contains an -ly adverb that could go, rewrite it.',
  'no-repeat':
    'Rewrite the passage {n} ways so the word “{focus}” is used only once: give one use a fitting alternative, or reshape that sentence. Change only what that needs and keep everything else as written.',
  // When the earlier use is outside the passage (a sentence or two back), the passage must drop the word entirely.
  'no-repeat-all':
    'The word “{focus}” was already used a few lines earlier. Rewrite the passage {n} ways without “{focus}” or any other form of it: use a fitting alternative, or reshape the sentence so it isn’t needed. Change only what that needs and keep everything else as written. Check each version: if it still contains “{focus}”, rewrite it.',
  clearer: 'Rewrite the passage {n} ways so it is easier to follow: split overlong sentences, make it clear who does what and what pronouns refer to.',
  grammar: 'Correct grammar, spelling and punctuation in the passage with the smallest possible changes. Do not change style or word choice. If it is already correct, return it unchanged.',
  tone: 'Rewrite the passage {n} ways to sound {tone}, keeping its events and meaning.',
  show: 'Rewrite the passage {n} ways that show instead of tell: replace stated emotions or summaries with concrete action, body language, sensory detail or dialogue implied by the passage. Do not invent plot.',
  voice:
    'The passage is one line of dialogue. Rewrite only the spoken words, {n} ways, so they sound like {character} would say them, judging from their notes (personality, how they speak). Keep what is said and roughly the same length; change how it is said. Each version must be just the quoted line itself, with the same quotation marks and the same closing punctuation as the original: no speech tag (no "she said"), no action, no description, and nothing taken from the notes.',
};

function charactersBlock(chars: readonly CharacterContext[]): string {
  if (!chars.length) return '';
  const lines = chars.map((c) => {
    const notes = Object.entries(c.notes)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `  ${k}: ${v.trim().replace(/\s*\n\s*/g, '; ')}`)
      .join('\n');
    return `- ${c.name}${c.aliases.length ? ` (also: ${c.aliases.join(', ')})` : ''}${notes ? `\n${notes}` : ''}`;
  });
  return `\n\nCharacters in this passage, from the author's notes (read-only facts; never contradict them):\n${lines.join('\n')}`;
}

export interface TaskInput {
  text: string;
  /** The paragraphs around the passage, for context only. */
  context?: string;
  characters?: readonly CharacterContext[];
  tone?: string;
  /** For "voice": the character to sound like. */
  character?: string;
  question?: string;
  /** The flagged words to work on (from a clicked mark); the rest of the passage should stay as it is. */
  focus?: string | null;
}

/** The messages for one AI Editor action. */
export function buildMessages(task: AiTask, input: TaskInput): ChatMessage[] {
  const chars = charactersBlock(input.characters ?? []);
  const context = input.context?.trim() ? `\n\nSurrounding text, for context only (do not edit it):\n"""${input.context.trim()}"""` : '';
  if (task.id === 'ask') {
    return [
      {
        role: 'system',
        content: `You are a thoughtful fiction editor answering a novelist's question about their own passage. Be specific and brief (under 150 words). Quote the passage when pointing at something. Never rewrite the whole passage unless asked.${chars}`,
      },
      { role: 'user', content: `Passage:\n"""${input.text}"""${context}\n\nQuestion: ${input.question ?? 'Is anything here unclear or weak?'}` },
    ];
  }
  const asked = task.request ?? task.versions;
  const focus = input.focus?.trim();
  const base =
    task.id === 'no-adverb' && focus
      ? `Rewrite the passage {n} ways without the word “${focus}”: carry its meaning with a more precise verb, a concrete image or the shape of the sentence. Change only what that needs, keep everything else as written, and don't add other adverbs.`
      : task.id === 'no-repeat'
        ? focus && echoUses(input.text, focus) < 2
          ? INSTRUCTIONS['no-repeat-all'].replaceAll('{focus}', focus)
          : INSTRUCTIONS['no-repeat'].replace('{focus}', focus ?? 'the repeated word')
        : INSTRUCTIONS[task.id] + (focus ? ` Focus on “${focus}”, the part flagged as needing work; keep the rest as close to the original as you can.` : '');
  const instruction = base
    .replace('{n}', String(asked))
    .replace('{tone}', input.tone ?? 'warmer')
    .replace('{character}', input.character ?? 'the character');
  const format = asked > 1 ? `\n\nGive exactly ${asked} versions as a numbered list (1., 2., …), each complete on its own.` : '';
  return [
    { role: 'system', content: EDITOR_BRIEF + chars },
    { role: 'user', content: `${instruction}${format}${context}\n\nPassage:\n"""${input.text}"""` },
  ];
}

/** "-ly" words that aren't adverbs (or that change the meaning) and so don't count against a version. */
const NOT_ADVERBS = new Set(['only', 'early', 'family', 'likely', 'unlikely', 'lonely', 'friendly', 'ugly', 'holy', 'reply', 'supply', 'apply', 'fly', 'belly', 'silly', 'daily', 'barely', 'nearly', 'hardly', 'scarcely', 'rally', 'ally', 'july', 'italy', 'lily', 'jelly', 'bully', 'curly', 'chilly', 'elderly', 'costly', 'deadly', 'lovely', 'lively']);

export function countAdverbs(text: string): number {
  const ly = (text.match(/\b[a-z]{3,}ly\b/gi) ?? []).filter((w) => !NOT_ADVERBS.has(w.toLowerCase())).length;
  return ly + (text.match(/\b(?:very|really|quite)\s+[a-z]+/gi) ?? []).length;
}

/** How many times a word (in any form: "tight", "tightly") appears in a text. */
export function echoUses(text: string, word: string): number {
  const s = stem(word);
  return (text.match(/[\p{L}’']+/gu) ?? []).filter((w) => stem(w) === s).length;
}

/**
 * The versions to show: for "Without the adverb", the ones that really manage without, best first; for "Without
 * the echo", only those that really use the word less (none, if the model kept it every time).
 */
export function pickBest(task: AiTask, options: string[], original = '', focus?: string | null): string[] {
  if (task.id === 'voice') return [...new Set(options.map((o) => withQuotesOf(spokenPart(o), original)))].slice(0, task.versions);
  if (task.id === 'no-repeat' && focus) {
    const allowed = Math.max(0, echoUses(original, focus) - 1);
    return options.filter((o) => echoUses(o, focus) <= allowed).slice(0, task.versions);
  }
  if (task.id !== 'no-adverb') return options.slice(0, Math.max(task.versions, 1));
  return options
    .map((o, i) => ({ o, i, n: countAdverbs(o) }))
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .slice(0, task.versions)
    .map((x) => x.o);
}

/** Just the quoted words of a dialogue suggestion, dropping any tag or description the model added around them. */
export function spokenPart(text: string): string {
  const curly = /“[^”]*”/.exec(text);
  if (curly) return curly[0];
  const straight = /"[^"]*"/.exec(text);
  return straight ? straight[0] : text.trim();
}

/** Puts back the original line's quotation marks and closing punctuation (“…,”) if the model dropped them. */
export function withQuotesOf(line: string, original: string): string {
  const m = /^(["“])[\s\S]*?([,.!?…—-]*)(["”])$/.exec(original.trim());
  const body = line.trim();
  if (!m || /^["“]/.test(body)) return body;
  if (/[!?…]$/.test(body)) return m[1] + body + m[3];
  return m[1] + body.replace(/[.,;:]+$/, '') + m[2] + m[3];
}
