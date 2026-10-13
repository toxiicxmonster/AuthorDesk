import { chat, type ChatOptions } from './aiEditor';

/**
 * AI Editor → "Find character details in this scene": facts about listed characters (looks, personality, fears,
 * backstory, voice…) that the scene states but their entries don't have yet. Each is offered as a line to add to
 * the character's entry; nothing is added without a click, and the manuscript is never changed.
 */

export interface CharacterForScan {
  id: string;
  name: string;
  aliases: string[];
  fields: Record<string, string>;
}

export interface FoundDetail {
  characterId: string;
  characterName: string;
  field: string;
  fact: string;
  /** The words in the scene that state it. */
  quote: string;
}

/** Character fields the scan may fill, with what goes in each. */
export const SCAN_FIELDS: Record<string, string> = {
  appearance: 'physical appearance',
  personality: 'personality and temperament',
  goals: 'goals and motivations',
  fears: 'fears and secrets',
  strengths: 'strengths and skills',
  flaws: 'flaws and limitations',
  backstory: 'backstory and history',
  voice: 'how they speak',
};

const SCHEMA = {
  type: 'object',
  properties: {
    details: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          character: { type: 'string' },
          field: { type: 'string', enum: Object.keys(SCAN_FIELDS) },
          fact: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['character', 'field', 'fact', 'quote'],
      },
    },
  },
  required: ['details'],
};

const norm = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

/** Keeps only details about listed characters, in a real field, quoted word for word from the scene, and new to the entry. */
export function validateDetails(raw: unknown, characters: readonly CharacterForScan[], scene: string): FoundDetail[] {
  const list = (raw as { details?: unknown[] })?.details;
  if (!Array.isArray(list)) return [];
  const sceneN = norm(scene);
  const out: FoundDetail[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const d = item as Partial<Record<'character' | 'field' | 'fact' | 'quote', string>>;
    if (!d.character || !d.field || !d.fact?.trim() || !d.quote?.trim() || !(d.field in SCAN_FIELDS)) continue;
    const who = norm(d.character);
    const c = characters.find((x) => [x.name, ...x.aliases].some((n) => norm(n) === who || norm(n).split(' ').includes(who)));
    if (!c) continue;
    if (!sceneN.includes(norm(d.quote))) continue; // made up
    const fact = d.fact.trim().replace(/\.$/, '');
    if (norm(c.fields[d.field] ?? '').includes(norm(fact))) continue; // already noted
    const key = `${c.id}|${d.field}|${norm(fact)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ characterId: c.id, characterName: c.name, field: d.field, fact, quote: d.quote.trim() });
  }
  return out;
}

export async function findDetailsWithAi(scene: string, characters: readonly CharacterForScan[], opts: Pick<ChatOptions, 'signal' | 'fetchImpl'> = {}): Promise<FoundDetail[]> {
  if (!characters.length || !scene.trim()) return [];
  const notes = characters
    .map((c) => {
      const known = Object.keys(SCAN_FIELDS)
        .filter((k) => c.fields[k]?.trim())
        .map((k) => `  ${k}: ${c.fields[k].trim().replace(/\s*\n\s*/g, '; ')}`)
        .join('\n');
      return `- ${c.name}${c.aliases.length ? ` (also: ${c.aliases.join(', ')})` : ''}\n${known || '  (no notes yet)'}`;
    })
    .join('\n');
  const answer = await chat(
    [
      {
        role: 'system',
        content: `You help a novelist keep character notes up to date. From the scene, list facts about the listed characters that the scene clearly states and their notes don't already contain.
Fields: ${Object.entries(SCAN_FIELDS)
          .map(([k, v]) => `${k} (${v})`)
          .join(', ')}.
Rules: only facts the scene states (no guesses); only the listed characters; "fact" is a short note under 12 words; "quote" is the exact words from the scene that state it. If there is nothing new, return an empty list.`,
      },
      { role: 'user', content: `Characters and their current notes:\n${notes}\n\nScene:\n"""${scene.slice(0, 16_000)}"""` },
    ],
    { ...opts, temperature: 0.1, maxTokens: 900, schema: SCHEMA },
  );
  try {
    return validateDetails(JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)), characters, scene);
  } catch {
    return [];
  }
}
