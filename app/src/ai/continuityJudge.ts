import { chat, type ChatOptions } from './aiEditor';
import type { Contradiction, ContinuityScene } from '../proofreading/continuity';

/**
 * "Contradiction or deliberate change?": for a detail described two ways (green eyes, then brown), the AI Editor
 * reads both passages and what the story says about that detail in between (a dye job, contacts, years passing)
 * and gives its view as a short note. It never decides anything: the author still chooses "Changed on purpose".
 */

export type ChangeVerdict = 'mistake' | 'deliberate' | 'unclear';

export interface ChangeView {
  verdict: ChangeVerdict;
  reason: string;
}

const MAX_PASSAGE = 1_400;
const MAX_BETWEEN = 6;

const clip = (t: string) => (t.length > MAX_PASSAGE ? `${t.slice(0, MAX_PASSAGE)}…` : t);

/** The paragraph a detail is in, with the one before it for context. */
function passage(scenes: readonly ContinuityScene[], sceneId: string, block: number): string {
  const s = scenes.find((x) => x.sceneId === sceneId);
  if (!s) return '';
  return clip(s.paragraphs.slice(Math.max(0, block - 1), block + 1).join('\n'));
}

/** Paragraphs between the two passages that talk about the same detail ("hair", "dyed", "contacts"). */
function between(scenes: readonly ContinuityScene[], c: Contradiction): string[] {
  const words = new Set([c.label.toLowerCase(), ...(WORDS[c.label.toLowerCase()] ?? [])]);
  const re = new RegExp(`\\b(?:${[...words].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
  const from = scenes.findIndex((s) => s.sceneId === c.first.sceneId);
  const to = scenes.findIndex((s) => s.sceneId === c.other.sceneId);
  if (from < 0 || to < 0) return [];
  const out: string[] = [];
  for (let i = from; i <= to && out.length < MAX_BETWEEN; i++) {
    scenes[i].paragraphs.forEach((p, b) => {
      if (out.length >= MAX_BETWEEN) return;
      if (i === from && b <= c.first.block) return;
      if (i === to && b >= c.other.block) return;
      if (re.test(p)) out.push(clip(p));
    });
  }
  return out;
}

// What else the story might say when a detail changes on purpose.
const WORDS: Record<string, string[]> = {
  hair: ['dye', 'dyed', 'bleach', 'cut', 'shaved', 'wig', 'grey', 'gray', 'highlights'],
  eyes: ['contact', 'lenses', 'glasses'],
  build: ['weight', 'thin', 'muscle', 'trained', 'gym', 'pregnan'],
  height: ['grew', 'taller', 'heels'],
  age: ['birthday', 'years', 'turned'],
};

export function changeMessages(c: Contradiction, scenes: readonly ContinuityScene[]) {
  const mid = between(scenes, c);
  return [
    {
      role: 'system' as const,
      content:
        'You help a novelist check continuity. A character’s detail is described one way in an earlier passage and another way in a later one. The story may be told in the first person, so “I” and “my” can be this character. First read the passages in between: if any of them changes the detail or explains it (dyed or cut hair, contacts, time passing, an injury, a disguise), the change is deliberate. If nothing given explains it, it looks like a mistake. Use “unclear” only when the passages might be about different people or the description may be a mistaken impression. One sentence of reason that quotes the words that decide it. Reply with JSON: {"verdict": "mistake" | "deliberate" | "unclear", "reason": "…"}.',
    },
    {
      role: 'user' as const,
      content: [
        `Character: ${c.characterName}. Detail: ${c.label.toLowerCase()}.`,
        `Earlier (${c.first.chapterTitle}), described as “${c.first.value}”:\n"""${passage(scenes, c.first.sceneId, c.first.block)}"""`,
        mid.length ? `Passages in between that mention it:\n${mid.map((p) => `"""${p}"""`).join('\n')}` : 'Nothing in between mentions it.',
        `Later (${c.other.chapterTitle}), described as “${c.other.value}”:\n"""${passage(scenes, c.other.sceneId, c.other.block)}"""`,
      ].join('\n\n'),
    },
  ];
}

const SCHEMA = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['mistake', 'deliberate', 'unclear'] }, reason: { type: 'string' } },
  required: ['verdict', 'reason'],
};

export function parseChangeView(answer: string): ChangeView {
  try {
    const j = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)) as { verdict?: unknown; reason?: unknown };
    const verdict: ChangeVerdict = j.verdict === 'mistake' || j.verdict === 'deliberate' ? j.verdict : 'unclear';
    return { verdict, reason: typeof j.reason === 'string' ? j.reason.trim() : '' };
  } catch {
    return { verdict: 'unclear', reason: answer.trim().slice(0, 300) };
  }
}

const cache = new Map<string, ChangeView>();

/** The AI Editor's view on one contradiction; remembered for the session per contradiction. */
export async function judgeChange(c: Contradiction, scenes: readonly ContinuityScene[], opts: Pick<ChatOptions, 'signal' | 'fetchImpl'> = {}): Promise<ChangeView> {
  const key = `${c.key}|${c.first.original}|${c.other.original}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const view = parseChangeView(await chat(changeMessages(c, scenes), { ...opts, temperature: 0, maxTokens: 160, schema: SCHEMA }));
  cache.set(key, view);
  return view;
}

export const VERDICT_LABEL: Record<ChangeVerdict, string> = {
  mistake: 'Looks like a mistake',
  deliberate: 'Looks deliberate',
  unclear: 'Hard to tell',
};
