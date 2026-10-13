import type { Suggestion } from './types';

/**
 * Character details: notices physical details written about a listed character ("Winnie pushed her auburn hair back")
 * that the character's reference entry doesn't have yet (green: add it) or contradicts (purple: update it).
 * Only ever offers to change the reference entry, never the manuscript. Pure.
 *
 * Attribution is deliberately cautious: possessive ("Winnie's eyes"), or a pronoun ("her eyes") when exactly one
 * listed character is named in the sentence, else in the paragraph so far, else at the end of the paragraph before.
 */

export interface CharacterInfo {
  id: string;
  name: string;
  aliases: string[];
  /** The entry's Physical appearance text, where details are stored as lines like "Hair: auburn". */
  appearance: string;
}

export type Attribute = 'hair' | 'eyes' | 'feature' | 'build' | 'age';

export interface FactHit {
  start: number;
  end: number;
  original: string;
  characterId: string;
  characterName: string;
  attribute: Attribute;
  /** Label of the line to store ("Hair", "Eyes", "Freckles", "Build", "Age"). */
  label: string;
  /** The detail as written ("auburn", "green", "freckles", "tall", "seventeen"). */
  value: string;
  /** What the entry says instead, when it contradicts; null when the entry just lacks it. */
  existing: string | null;
}

const HAIR_COLOURS = 'auburn|red|ginger|copper|coppery|blonde|blond|golden|platinum|strawberry-blonde|flaxen|honey|brown|chestnut|mousy|black|raven|jet-black|dark|grey|gray|silver|white|salt-and-pepper|sandy';
const EYE_COLOURS = 'blue|green|grey|gray|brown|hazel|amber|black|dark|violet|ice-blue|sea-green|emerald|sapphire|golden|silver';
const HAIR_STYLES = 'curly|wavy|straight|braided|cropped|short|long|shoulder-length|tangled|messy|thick|thin|frizzy|sleek|shaggy|shaved';
const FEATURES: [RegExp, string][] = [
  [/\bfreckle[sd]?\b/i, 'Freckles'],
  [/\b(?:glasses|spectacles)\b/i, 'Glasses'],
  [/\bscar(?:red|s)?\b/i, 'Scar'],
  [/\btattoo(?:s|ed)?\b/i, 'Tattoo'],
  [/\bbeard(?:ed)?\b/i, 'Beard'],
  [/\bdimples?\b/i, 'Dimples'],
  [/\bbirthmark\b/i, 'Birthmark'],
  [/\bpiercings?\b/i, 'Piercing'],
];
const BUILD = 'tall|short|petite|lanky|stocky|slender|slight|willowy|wiry|muscular|broad-shouldered|heavyset|plump|thin|gangly|towering';
const AGE_WORDS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|\\d{1,3}';

const POSSESSIVE = /\b(?:her|his|their)\s+$/i;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Mention {
  character: CharacterInfo;
  start: number;
  end: number;
}

/** Every mention of a listed character (full name, any part of it, or an alias). */
function mentions(text: string, chars: readonly CharacterInfo[]): Mention[] {
  const out: Mention[] = [];
  for (const c of chars) {
    const terms = new Set<string>();
    for (const n of [c.name, ...c.aliases]) {
      if (n.trim().length >= 2) terms.add(n.trim());
      for (const p of n.split(/\s+/)) if (p.length >= 3) terms.add(p);
    }
    const alts = [...terms].sort((a, b) => b.length - a.length).map(escapeRe);
    if (!alts.length) continue;
    const re = new RegExp(`(?<![\\p{L}'’-])(?:${alts.join('|')})(?![\\p{L}-])`, 'gu');
    for (const m of text.matchAll(re)) out.push({ character: c, start: m.index!, end: m.index! + m[0].length });
  }
  return out.sort((a, b) => a.start - b.start);
}

const unique = (ms: Mention[]) => [...new Map(ms.map((m) => [m.character.id, m.character])).values()];

/** Who a detail at `at` belongs to, or null if that isn't certain. */
function owner(text: string, at: number, ms: Mention[], prevParagraphOwners: CharacterInfo[]): CharacterInfo | null {
  // "Winnie's auburn hair"
  const poss = ms.find((m) => /^['’]s\s/.test(text.slice(m.end, m.end + 3)) && m.end + 3 >= at - 40 && m.end <= at);
  const between = poss ? text.slice(poss.end, at) : '';
  if (poss && /^['’]s(?:\s+[\p{L}-]+){0,4}\s*$/u.test(between)) return poss.character;
  if (!POSSESSIVE.test(text.slice(Math.max(0, at - 12), at)) && !/\b(?:with|had|has)\s+(?:[\p{L}-]+\s+){0,3}$/u.test(text.slice(Math.max(0, at - 40), at))) return null;
  const sentenceStart = Math.max(text.lastIndexOf('. ', at), text.lastIndexOf('! ', at), text.lastIndexOf('? ', at)) + 1;
  const inSentence = unique(ms.filter((m) => m.start >= sentenceStart && m.start < at));
  if (inSentence.length) return inSentence.length === 1 ? inSentence[0] : null;
  const inParagraph = unique(ms.filter((m) => m.start < at));
  if (inParagraph.length) return inParagraph.length === 1 ? inParagraph[0] : null;
  return prevParagraphOwners.length === 1 ? prevParagraphOwners[0] : null;
}

/** How the appearance text covers an attribute: null if it doesn't, else the value it gives (possibly ''). */
function stored(appearance: string, attribute: Attribute, label: string): { value: string; start: number; end: number } | null {
  const line = new RegExp(`^\\s*${escapeRe(label)}\\s*:\\s*(.*)$`, 'im').exec(appearance);
  if (line) {
    const start = line.index + line[0].indexOf(line[1]);
    return { value: line[1].trim(), start, end: start + line[1].length };
  }
  if (attribute === 'hair' || attribute === 'eyes') {
    const noun = attribute === 'hair' ? 'hair|haired' : 'eyes|eyed';
    const colours = attribute === 'hair' ? HAIR_COLOURS : EYE_COLOURS;
    const m = new RegExp(`\\b(${colours})(?:[\\s-]+(?:${HAIR_STYLES}))?[\\s-]*(?:${noun})\\b`, 'i').exec(appearance);
    if (m) return { value: m[1].toLowerCase(), start: m.index, end: m.index + m[1].length };
    if (new RegExp(`\\b(?:${noun})\\b`, 'i').test(appearance)) return { value: '', start: -1, end: -1 };
    return null;
  }
  if (attribute === 'build') {
    const m = new RegExp(`\\b(${BUILD})\\b`, 'i').exec(appearance);
    return m ? { value: m[1].toLowerCase(), start: m.index, end: m.index + m[1].length } : null;
  }
  if (attribute === 'age') {
    const m = new RegExp(`\\b(${AGE_WORDS})[- ]years?[- ]old\\b|\\bage[d:]?\\s+(${AGE_WORDS})\\b`, 'i').exec(appearance);
    return m ? { value: (m[1] ?? m[2]).toLowerCase(), start: m.index, end: m.index + m[0].length } : null;
  }
  // Features: present or not.
  const f = FEATURES.find(([, l]) => l === label);
  return f && f[0].test(appearance) ? { value: label.toLowerCase(), start: -1, end: -1 } : null;
}

const sameValue = (a: string, b: string) => {
  const norm = (s: string) => s.toLowerCase().replace(/gray/g, 'grey').replace(/blond\b/g, 'blonde');
  return norm(a).includes(norm(b)) || norm(b).includes(norm(a));
};

/**
 * Details about listed characters in one paragraph. `previous` is the paragraph before (for pronoun attribution).
 * Only details that are new to the entry (existing = null) or contradict it (existing = old value) are returned.
 */
export function findCharacterFacts(text: string, chars: readonly CharacterInfo[], previous = ''): FactHit[] {
  if (!chars.length) return [];
  const ms = mentions(text, chars);
  const prevMs = previous ? mentions(previous, chars) : [];
  const lastSentence = previous.slice(Math.max(previous.lastIndexOf('. '), 0));
  const prevOwners = unique(prevMs.filter((m) => m.start >= previous.length - lastSentence.length));
  if (!ms.length && !prevOwners.length) return [];

  const found: Omit<FactHit, 'existing'>[] = [];
  const add = (start: number, end: number, attribute: Attribute, label: string, value: string, who: CharacterInfo | null) => {
    if (who) found.push({ start, end, original: text.slice(start, end), characterId: who.id, characterName: who.name, attribute, label, value });
  };

  // Hair and eyes: "auburn hair", "curly black hair", "green eyes", "red-haired".
  for (const [attr, label, colours, noun] of [
    ['hair', 'Hair', HAIR_COLOURS, 'hair'],
    ['eyes', 'Eyes', EYE_COLOURS, 'eyes'],
  ] as const) {
    const re = new RegExp(`\\b((?:(?:${HAIR_STYLES}),?\\s+)*)(${colours})((?:,?\\s+(?:${HAIR_STYLES}))*)\\s+${noun}\\b`, 'gi');
    for (const m of text.matchAll(re)) add(m.index!, m.index! + m[0].length, attr, label, m[2].toLowerCase(), owner(text, m.index!, ms, prevOwners));
  }
  // Distinctive features: "her freckles", "Tom's scar", "had glasses".
  for (const [re, label] of FEATURES) {
    for (const m of text.matchAll(new RegExp(re.source, 'gi'))) add(m.index!, m.index! + m[0].length, 'feature', label, label.toLowerCase(), owner(text, m.index!, ms, prevOwners));
  }
  // Build and age, only with the name right there: "Winnie was tall", "the lanky Tom", "Winnie, seventeen,", "seventeen-year-old Winnie".
  for (const mention of ms) {
    const after = text.slice(mention.end, mention.end + 40);
    const before = text.slice(Math.max(0, mention.start - 30), mention.start);
    const b = new RegExp(`^\\s+(?:was|is|stood)\\s+(?:so\\s+|very\\s+|quite\\s+)?(${BUILD})\\b`, 'i').exec(after);
    if (b) add(mention.end + b.index + b[0].length - b[1].length, mention.end + b[0].length, 'build', 'Build', b[1].toLowerCase(), mention.character);
    const a = new RegExp(`^\\s+(?:was|is|turned)\\s+(${AGE_WORDS})\\b(?!\\s+(?:minutes|hours|days|weeks|months|feet|miles|steps|times))`, 'i').exec(after) ??
      new RegExp(`^,\\s+(${AGE_WORDS}),`, 'i').exec(after);
    if (a) {
      const at = mention.end + a[0].lastIndexOf(a[1]);
      add(at, at + a[1].length, 'age', 'Age', a[1].toLowerCase(), mention.character);
    }
    const ya = new RegExp(`\\b(${AGE_WORDS})-year-old\\s+$`, 'i').exec(before);
    if (ya) add(mention.start - (before.length - ya.index), mention.start - 1, 'age', 'Age', ya[1].toLowerCase(), mention.character);
  }

  const out: FactHit[] = [];
  const seen = new Set<string>();
  for (const f of found.sort((x, y) => x.start - y.start)) {
    const key = `${f.characterId}|${f.label}`;
    if (seen.has(key)) continue; // one prompt per character and detail per paragraph
    seen.add(key);
    const who = chars.find((c) => c.id === f.characterId)!;
    const have = stored(who.appearance, f.attribute, f.label);
    if (!have) out.push({ ...f, existing: null });
    else if (have.value && !sameValue(have.value, f.value) && f.attribute !== 'feature') out.push({ ...f, existing: have.value });
  }
  return out;
}

/** The appearance text with this detail added (missing) or updated (contradiction). */
export function applyFact(appearance: string, f: Pick<FactHit, 'attribute' | 'label' | 'value' | 'existing'>): string {
  const value = f.attribute === 'feature' ? 'yes' : f.value;
  if (f.existing !== null) {
    const have = stored(appearance, f.attribute, f.label);
    if (have && have.start >= 0) return appearance.slice(0, have.start) + f.value + appearance.slice(have.end);
  }
  const line = `${f.label}: ${value}`;
  return appearance.trim() ? `${appearance.replace(/\s+$/, '')}\n${line}` : line;
}

/** Character details as editor suggestions: green "add to the entry" notes and purple contradictions. */
export function characterDetailSuggestions(texts: readonly string[], chars: readonly CharacterInfo[], disabledRules: ReadonlySet<string>): Suggestion[][] {
  const wantNew = !disabledRules.has('character-fact');
  const wantConflict = !disabledRules.has('character-conflict');
  if (!chars.length || (!wantNew && !wantConflict)) return texts.map(() => []);
  return texts.map((text, i) =>
    findCharacterFacts(text, chars, texts[i - 1] ?? '')
      .filter((f) => (f.existing === null ? wantNew : wantConflict))
      .map((f): Suggestion => {
        const first = f.characterName.split(/\s+/)[0];
        const what = f.attribute === 'feature' ? f.label.toLowerCase() : f.attribute === 'build' ? 'height or build' : f.label.toLowerCase();
        return {
          start: f.start,
          end: f.end,
          original: f.original,
          replacements: [],
          category: 'consistency',
          severity: f.existing === null ? 'note' : 'conflict',
          ruleId: f.existing === null ? 'character-fact' : 'character-conflict',
          providerId: 'local-characters',
          message:
            f.existing === null
              ? `${f.characterName}’s character entry doesn’t mention ${what} yet. Add “${f.label}: ${f.attribute === 'feature' ? 'yes' : f.value}” to ${first}’s Physical appearance?`
              : `${f.characterName}’s character entry says ${f.label.toLowerCase()}: ${f.existing}, but here it’s ${f.value}. Update the entry, or change the text yourself if the entry is right.`,
          data: {
            characterId: f.characterId,
            characterName: f.characterName,
            attribute: f.attribute,
            label: f.label,
            value: f.value,
            existing: f.existing ?? '',
            // Remembered per character and detail, so a deliberate change (dyed hair) stops nagging once ignored.
            ignoreKey: `character|${f.characterId}|${f.label}`,
          },
        };
      }),
  );
}
