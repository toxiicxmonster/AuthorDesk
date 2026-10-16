import { chat, type ChatOptions } from './aiEditor';

/**
 * Logline, back-cover blurb and synopsis, drafted by the AI Editor from what the book already says about itself:
 * each chapter's summary, or its scenes' summaries, or its outline notes, or (when that's all there is) its opening.
 * The model is told to use only that material and to stop where it stops, so an unfinished book doesn't get an
 * invented ending. A draft for the author to rewrite, never published as it is.
 */

export type PitchKind = 'logline' | 'blurb' | 'synopsis';

export interface PitchChapter {
  title: string;
  summary: string;
  sceneSummaries: string[];
  /** The scenes' text, in order. */
  text: string;
}

export interface PitchCharacter {
  name: string;
  role: string;
  summary: string;
  goals: string;
  personality?: string;
}

export interface PitchSource {
  text: string;
  /** How each chapter was described: from a summary, outline notes, its opening, or not at all. */
  counts: { summary: number; notes: number; opening: number; empty: number };
}

const OPENING_WORDS = 120;
/** With a summary, a short taste of the prose too: it anchors who is who and the tone. */
const EXCERPT_WORDS = 60;
const MAX_CHARS = 12_000;

/** Outline notes in a scene: lines like "- Finn helps her clean up". */
function outlineNotes(text: string): string[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /^[-*•–]\s+\S/.test(l))
    .map((l) => l.replace(/^[-*•–]\s+/, ''));
}

export function pitchSource(chapters: readonly PitchChapter[], characters: readonly PitchCharacter[]): PitchSource {
  const counts = { summary: 0, notes: 0, opening: 0, empty: 0 };
  const parts: string[] = [];
  chapters.forEach((c, i) => {
    const head = `Chapter ${i + 1}${c.title && !/^chapter\s+\d+[.:)]?\s*$/i.test(c.title) ? ` (${c.title.replace(/^chapter\s+\d+[.:)\s-]*/i, '')})` : ''}:`;
    const summary = c.summary.trim() || c.sceneSummaries.filter((s) => s.trim()).join(' ');
    if (summary) {
      counts.summary++;
      const prose = c.text
        .split(/\n+/)
        .filter((l) => !/^\s*[-*•–]\s/.test(l))
        .join(' ')
        .split(/\s+/)
        .filter(Boolean);
      const taste = prose.length >= 40 ? ` (opening) ${prose.slice(0, EXCERPT_WORDS).join(' ')}…` : '';
      parts.push(`${head} ${summary.replace(/\s*\n+\s*/g, ' ')}${taste}`);
      return;
    }
    const notes = outlineNotes(c.text);
    if (notes.length) {
      counts.notes++;
      parts.push(`${head} (outline) ${notes.join('; ')}`);
      return;
    }
    const prose = c.text.split(/\s+/).filter(Boolean);
    if (prose.length) {
      counts.opening++;
      parts.push(`${head} (opening) ${prose.slice(0, OPENING_WORDS).join(' ')}${prose.length > OPENING_WORDS ? '…' : ''}`);
      return;
    }
    counts.empty++;
  });
  const cast = characters
    .filter((c) => c.name.trim())
    .map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ''}${c.summary ? `: ${c.summary}` : ''}${c.personality ? ` Personality: ${c.personality}.` : ''}${c.goals ? ` Wants: ${c.goals}` : ''}`);
  let text = `${cast.length ? `Characters:\n${cast.join('\n')}\n\n` : ''}Chapters:\n${parts.join('\n')}`;
  if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}\n[…the rest is left out for length]`;
  return { text, counts };
}

const BRIEF =
  'You help a novelist draft marketing copy for their own book. Use only what the material says: invent no events, characters, settings or ending. ' +
  'Never name a town, school or place the material doesn’t name, never retitle the book, and take how characters are related (who is dating whom, who is whose rival) and what they are like only from the material; keep each trait with the character it belongs to. ' +
  'Chapters marked (outline) are the author’s plans and (opening) is the first lines of a chapter. If the material stops before the story ends, ' +
  'stop where it stops and don’t make up how it ends. Write plain text: no headings, no labels, no quotation marks around the answer.';

const ASK: Record<PitchKind, string> = {
  logline:
    'Write a logline: one sentence of at most 35 words naming the main character, what they want, what stands in the way, and what’s at stake. Give exactly one logline.',
  blurb:
    'Write back-cover copy of 120 to 180 words in the present tense: open with a hook, introduce the main character and their situation, raise the central conflict and the stakes, and end on a question or a moment of suspense. Don’t give away the ending.',
  synopsis:
    'Write a synopsis of 300 to 600 words in the present tense and the third person, as agents expect: the main plot points in order, the main characters’ motivations and how they change, and the ending if the material reaches it. Write each character’s name in capitals the first time it appears.',
};

export function pitchMessages(kind: PitchKind, title: string, source: string) {
  return [
    { role: 'system' as const, content: BRIEF },
    { role: 'user' as const, content: `${ASK[kind]}\n\nBook: ${title || 'Untitled'}\n\n${source}` },
  ];
}

/** Removes chatter models add around the answer ("Here's a blurb:"), and stray Markdown. */
export function cleanPitch(answer: string): string {
  return answer
    .trim()
    .replace(/^(?:sure[,!.]?\s*)?(?:here(?:['’]s| is)[^:\n]*:\s*)/i, '')
    .replace(/^\s*(?:#+\s*)?(?:\*\*)?(?:logline|blurb|back[- ]cover copy|synopsis)\s*:?\s*(?:\*\*)?\s*:?\s*\n?/i, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^["“](.*)["”]$/s, '$1')
    .trim();
}

export async function draftPitch(kind: PitchKind, title: string, source: string, opts: Pick<ChatOptions, 'signal' | 'fetchImpl' | 'onText'> = {}): Promise<string> {
  const maxTokens = kind === 'logline' ? 120 : kind === 'blurb' ? 400 : 1100;
  return cleanPitch(await chat(pitchMessages(kind, title, source), { ...opts, temperature: 0.35, maxTokens }));
}

/**
 * Capitalised words in a draft that appear nowhere in the material or the title (an invented town, a new name),
 * for the author to check. Words starting a sentence are skipped.
 */
export function unknownNames(draft: string, source: string, title = ''): string[] {
  const known = new Set(`${source} ${title}`.toLowerCase().match(/\p{L}[\p{L}'’-]*/gu) ?? []);
  const out = new Set<string>();
  for (const m of draft.matchAll(/(?<=[\p{Ll},;]\s)(\p{Lu}[\p{Ll}'’-]+)/gu)) {
    const w = m[1].replace(/['’]s$/, '');
    if (!known.has(w.toLowerCase()) && !COMMON_CAPS.has(w)) out.add(w);
  }
  return [...out];
}

const COMMON_CAPS = new Set(['Grandma', 'Grandpa', 'God', 'Mom', 'Dad', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Christmas']);
