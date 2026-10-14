import { avoidEchoes, noticeable, stem } from '../proofreading/echo';
import { chat, type ChatOptions } from './aiEditor';

/**
 * Alternatives for a word that fit its sentence: same part of speech, tense and number, same meaning and tone.
 * Used for echo words, where a general thesaurus often suggests words that don't fit ("glanced" → "flashed").
 */

const cache = new Map<string, string[]>();

const SCHEMA = {
  type: 'object',
  properties: { alternatives: { type: 'array', items: { type: 'string' } } },
  required: ['alternatives'],
};

/** Matches the word's capitalisation (first letter / all caps). */
function caseLike(source: string, word: string): string {
  if (source.length > 1 && source === source.toUpperCase()) return word.toUpperCase();
  if (source[0] && source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}

/** Cleans the model's list: real alternatives only, short, no repeats, cased like the original. */
export function tidyAlternatives(word: string, list: unknown, nearby = ''): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>([word.toLowerCase()]);
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const alt = raw.trim().replace(/^["“']|["”'.,;:!?]$/g, '').trim();
    if (!alt || alt.split(/\s+/).length > 3 || /[\n()]/.test(alt)) continue;
    if (seen.has(alt.toLowerCase())) continue;
    // A single word in another tense won't drop in ("walked" → "marching").
    const single = !/\s/.test(alt);
    if (single && ((/ed$/i.test(word) && /ing$/i.test(alt)) || (/ing$/i.test(word) && /ed$/i.test(alt)))) continue;
    seen.add(alt.toLowerCase());
    out.push(caseLike(word, word[0] === word[0].toLowerCase() ? alt.toLowerCase() : alt));
  }
  return avoidEchoes(word, out, nearby).slice(0, 5);
}

/** `nearby` is the passage around the word: alternatives already used there are left out, so they don't echo. */
export async function contextSynonyms(
  word: string,
  sentence: string,
  opts: Pick<ChatOptions, 'signal' | 'fetchImpl'> = {},
  nearby = '',
): Promise<string[]> {
  const key = `${word.toLowerCase()}\u0001${sentence}\u0001${nearby}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const avoid = [...new Set(noticeable(nearby))].filter((w) => stem(w) !== stem(word));
  const answer = await chat(
    [
      {
        role: 'system',
        content:
          'You suggest replacement words for a novelist. Give alternatives that can replace the word exactly where it stands: same part of speech, tense and number, same meaning and tone, so the sentence still reads naturally. Never use the word itself in another form, and never a word the writer has already used nearby. No explanations.',
      },
      {
        role: 'user',
        content:
          `Sentence: ${sentence}\nWord to replace: "${word}"\n` +
          (avoid.length ? `Already used nearby (don't suggest these): ${avoid.join(', ')}\n` : '') +
          `\nReply with JSON: {"alternatives": ["…", "…"]} with up to 8 options, best first.`,
      },
    ],
    { ...opts, temperature: 0.2, maxTokens: 160, schema: SCHEMA },
  );
  let list: unknown = [];
  try {
    list = (JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)) as { alternatives?: unknown }).alternatives;
  } catch {
    /* unreadable: no alternatives */
  }
  const out = tidyAlternatives(word, list, nearby);
  if (out.length) cache.set(key, out);
  return out;
}
