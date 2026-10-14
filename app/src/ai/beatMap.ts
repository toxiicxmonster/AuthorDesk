import { chat, type ChatOptions } from './aiEditor';

/** The AI Editor's reading of which scene fills each beat, from scene summaries (or openings). Suggestions only. */

export interface BeatForAi {
  id: string;
  title: string;
  summary: string;
  /** Where it usually falls, 0–1. */
  at: number;
}

export interface SceneForAi {
  sceneId: string;
  label: string;
  /** Its summary, or the opening of its text. */
  gist: string;
  /** Where it starts, 0–1. */
  at: number;
}

export interface BeatMatch {
  beatId: string;
  sceneId: string;
  why: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: { type: 'object', properties: { beat: { type: 'integer' }, scene: { type: 'integer' }, why: { type: 'string' } }, required: ['beat', 'scene', 'why'] },
    },
  },
  required: ['matches'],
};

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** What a scene is about for matching: its summary, or a sample of its beginning, middle and end. */
export function sceneGist(summary: string, text: string): string {
  if (summary.trim()) return summary.trim();
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= 700) return t;
  const mid = Math.floor(t.length / 2);
  return `${t.slice(0, 260)} … ${t.slice(mid - 90, mid + 90)} … ${t.slice(-260)}`;
}

export function beatMapMessages(beats: readonly BeatForAi[], scenes: readonly SceneForAi[]) {
  const sceneList = scenes.map((s, i) => `${i + 1}. [${pct(s.at)}] ${s.label}: ${s.gist.replace(/\s+/g, ' ').slice(0, 720)}`).join('\n');
  const beatList = beats.map((b, i) => `${i + 1}. ${b.title} (usually around ${pct(b.at)}): ${b.summary}`).join('\n');
  return [
    {
      role: 'system' as const,
      content:
        'You help a novelist see how their draft fits a story structure. Match a beat to a scene only when what happens in that scene clearly does that beat’s job; where it falls in the book matters less than what happens. A draft that isn’t finished has no scene yet for many beats: leave those out. Beats come in order, so later beats can’t go to earlier scenes. The reason must describe only what the scene says happens. Never invent events.',
    },
    {
      role: 'user' as const,
      content: `Scenes, in order (with how far through the book each starts):\n${sceneList}\n\nBeats:\n${beatList}\n\nReply with JSON: {"matches": [{"beat": <beat number>, "scene": <scene number>, "why": "<one short sentence>"}]}.`,
    },
  ];
}

/**
 * Keeps the matches in story order: beats are in order, so their scenes must not go backwards. Keeps the longest run
 * that does (dropping the stragglers), and at most `perScene` beats on any one scene.
 */
export function inStoryOrder(matches: readonly BeatMatch[], beats: readonly { id: string }[], scenes: readonly { sceneId: string }[], perScene = 3): BeatMatch[] {
  const b = (m: BeatMatch) => beats.findIndex((x) => x.id === m.beatId);
  const s = (m: BeatMatch) => scenes.findIndex((x) => x.sceneId === m.sceneId);
  const list = [...matches].sort((x, y) => b(x) - b(y));
  // Longest non-decreasing run of scene positions (O(n²) is fine for a few dozen beats).
  const best = list.map(() => 1);
  const prev = list.map(() => -1);
  for (let i = 0; i < list.length; i++)
    for (let j = 0; j < i; j++)
      if (s(list[j]) <= s(list[i]) && best[j] + 1 > best[i]) {
        best[i] = best[j] + 1;
        prev[i] = j;
      }
  let at = best.indexOf(Math.max(0, ...best));
  const keep: BeatMatch[] = [];
  while (at >= 0) {
    keep.unshift(list[at]);
    at = prev[at];
  }
  const used = new Map<string, number>();
  return keep.filter((m) => {
    const n = (used.get(m.sceneId) ?? 0) + 1;
    used.set(m.sceneId, n);
    return n <= perScene;
  });
}

/** Reads the model's answer, keeping only real beat and scene numbers. */
export function readBeatMatches(answer: string, beats: readonly BeatForAi[], scenes: readonly SceneForAi[]): BeatMatch[] {
  let parsed: { matches?: unknown };
  try {
    parsed = JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.matches)) return [];
  const out: BeatMatch[] = [];
  for (const m of parsed.matches as { beat?: unknown; scene?: unknown; why?: unknown }[]) {
    const b = beats[Number(m.beat) - 1];
    const s = scenes[Number(m.scene) - 1];
    if (!b || !s || out.some((o) => o.beatId === b.id)) continue;
    out.push({ beatId: b.id, sceneId: s.sceneId, why: typeof m.why === 'string' ? m.why.trim().slice(0, 200) : '' });
  }
  return out;
}

export async function mapBeatsWithAi(beats: readonly BeatForAi[], scenes: readonly SceneForAi[], opts: Pick<ChatOptions, 'signal' | 'fetchImpl'> = {}): Promise<BeatMatch[]> {
  if (!beats.length || !scenes.length) return [];
  const answer = await chat(beatMapMessages(beats, scenes.slice(0, 150)), { ...opts, temperature: 0.2, maxTokens: 120 + beats.length * 60, schema: SCHEMA });
  return inStoryOrder(readBeatMatches(answer, beats, scenes.slice(0, 150)), beats, scenes.slice(0, 150));
}
