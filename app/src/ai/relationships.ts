import { chat, type ChatOptions } from './aiEditor';
import type { ReferenceEntry } from '../domain/schema';

/**
 * "Suggest relationships": the AI Editor reads the character entries, the author's notes and the chapter summaries,
 * and proposes how listed characters are related, each with the line it's based on. Only pairs of characters that
 * are already listed, only relationships not already recorded, and only suggestions whose quoted line really is in
 * the material are kept. The author adds each one or not.
 */

export interface RelationSuggestion {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  /** What B is to A ("boyfriend"), and what A is to B ("girlfriend"). */
  bToA: string;
  aToB: string;
  evidence: string;
}

type Char = Pick<ReferenceEntry, 'id' | 'name' | 'aliases' | 'summary' | 'fields' | 'notes' | 'links' | 'type' | 'archivedAt'>;

const MAX_CHARS = 12_000;

export function relationSource(characters: readonly Char[], notes: readonly { title: string; body: string }[], summaries: readonly string[]): string {
  const cast = characters.map((c) => {
    const fields = Object.entries(c.fields)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `${k}: ${v.trim()}`)
      .join('; ');
    return `- ${c.name}${c.aliases.length ? ` (also: ${c.aliases.join(', ')})` : ''}${c.summary ? `: ${c.summary}` : ''}${fields ? ` [${fields}]` : ''}${c.notes.trim() ? ` Notes: ${c.notes.trim().replace(/\s*\n+\s*/g, ' ')}` : ''}`;
  });
  const parts = [`Characters:\n${cast.join('\n')}`];
  const n = notes.filter((x) => x.body.trim()).map((x) => `- ${x.title}: ${x.body.trim().replace(/\s*\n+\s*/g, ' ')}`);
  if (n.length) parts.push(`The author's notes:\n${n.join('\n')}`);
  const s = summaries.filter((x) => x.trim()).map((x, i) => `- ${i + 1}. ${x.trim().replace(/\s*\n+\s*/g, ' ')}`);
  if (s.length) parts.push(`Chapter summaries:\n${s.join('\n')}`);
  const text = parts.join('\n\n');
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[…]` : text;
}

/** Relationship words the suggestions may use (and their usual reverse); anything else is left out. */
export const RELATION_WORDS: Record<string, string> = {
  mother: 'child', father: 'child', parent: 'child', son: 'parent', daughter: 'parent', child: 'parent',
  grandmother: 'grandchild', grandfather: 'grandchild', grandparent: 'grandchild', granddaughter: 'grandparent', grandson: 'grandparent', grandchild: 'grandparent',
  sister: 'sibling', brother: 'sibling', sibling: 'sibling', aunt: 'niece or nephew', uncle: 'niece or nephew', niece: 'aunt or uncle', nephew: 'aunt or uncle', cousin: 'cousin',
  wife: 'husband', husband: 'wife', spouse: 'spouse', fiancee: 'fiancé', fiancée: 'fiancé', fiance: 'fiancée', fiancé: 'fiancée',
  girlfriend: 'boyfriend', boyfriend: 'girlfriend', partner: 'partner', ex: 'ex', 'ex-girlfriend': 'ex-boyfriend', 'ex-boyfriend': 'ex-girlfriend', crush: 'admirer',
  friend: 'friend', 'best friend': 'best friend', roommate: 'roommate', neighbour: 'neighbour', neighbor: 'neighbor', classmate: 'classmate',
  rival: 'rival', enemy: 'enemy', teammate: 'teammate', coach: 'player', player: 'coach', boss: 'employee', employee: 'boss', colleague: 'colleague', mentor: 'mentee',
  stepmother: 'stepchild', stepfather: 'stepchild', stepsister: 'stepsibling', stepbrother: 'stepsibling',
};

export function relationMessages(source: string) {
  return [
    {
      role: 'system' as const,
      content:
        'You read a novelist’s notes and list how their characters are related. Write each relationship as a sentence in this order: PERSON is the ROLE of OTHER, for example {"person": "Betty Hartley", "role": "grandmother", "of": "Winnie Hartley", "reverse": "granddaughter"} means Betty is Winnie’s grandmother and Winnie is Betty’s granddaughter. ' +
        'ROLE must be a plain relationship word: a family member (mother, grandmother, sister…), a partner (girlfriend, boyfriend, wife, ex…), friend, best friend, rival, enemy, teammate, coach, boss, colleague, mentor, roommate, neighbour or classmate. ' +
        'Only relationships the material states or makes unmistakable, never a guess and never a description like "protector". Only characters from the Characters list, with their names exactly as listed. ' +
        'For each, quote the shortest words from the material that show it (at most 25 words), copied exactly. Reply with JSON: {"relations": [{"person": "…", "role": "…", "of": "…", "reverse": "…", "evidence": "…"}]}.',
    },
    { role: 'user' as const, content: source },
  ];
}

const SCHEMA = {
  type: 'object',
  properties: {
    relations: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        properties: { person: { type: 'string' }, role: { type: 'string' }, of: { type: 'string' }, reverse: { type: 'string' }, evidence: { type: 'string' } },
        required: ['person', 'role', 'of', 'reverse', 'evidence'],
      },
    },
  },
  required: ['relations'],
};

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Is the quoted evidence really in the material? (Most of its words, in a row, allowing small slips.) */
export function quoted(evidence: string, source: string): boolean {
  const e = words(evidence);
  if (e.length < 2) return false;
  const src = words(source);
  // Longest run of the evidence's words found consecutively in the source.
  let best = 0;
  for (let i = 0; i < src.length; i++) {
    let k = 0;
    while (k < e.length && src[i + k] === e[k]) k++;
    best = Math.max(best, k);
    if (best === e.length) break;
  }
  if (best >= Math.min(e.length, 6)) return true;
  // Or most of its words appear in the source at all (the model trimmed or joined a line).
  const have = new Set(src);
  return e.filter((w) => have.has(w)).length / e.length >= 0.8 && best >= 3;
}

// Family words as people write them ("Grandma died") and the role each one means.
const KIN: [RegExp, string][] = [
  [/\b(?:grandma|grandmother|granny|gran|nana|grammy|mawmaw)\b/i, 'grandmother'],
  [/\b(?:grandpa|grandfather|granddad|pawpaw)\b/i, 'grandfather'],
  [/\b(?:mom|mum|mother|mama|momma|mommy)\b/i, 'mother'],
  [/\b(?:dad|father|papa|daddy)\b/i, 'father'],
  [/\b(?:sister|sis)\b/i, 'sister'],
  [/\b(?:brother|bro)\b/i, 'brother'],
  [/\baunt(?:ie)?\b/i, 'aunt'],
  [/\buncle\b/i, 'uncle'],
  [/\b(?:wife)\b/i, 'wife'],
  [/\b(?:husband)\b/i, 'husband'],
];
const FAMILY = new Set(['mother', 'father', 'parent', 'son', 'daughter', 'child', 'grandmother', 'grandfather', 'grandparent', 'granddaughter', 'grandson', 'grandchild', 'sister', 'brother', 'sibling', 'aunt', 'uncle', 'niece', 'nephew', 'cousin', 'wife', 'husband', 'spouse', 'stepmother', 'stepfather', 'stepsister', 'stepbrother']);
// What a quote must mention for each other kind of relationship.
const SUPPORT: [RegExp, RegExp][] = [
  [/^(?:girlfriend|boyfriend|partner|crush|fiancée?|fiance|ex(?:-\w+)?)$/, /\b(?:couple|dating|date[sd]?|together|relationship|boyfriend|girlfriend|kiss\w*|love[sd]?|partner|engaged|fianc\w*|ex|broke up|married)\b/i],
  [/^(?:friend|best friend)$/, /\bfriends?\b|\bbestie\b|\bbff\b/i],
  [/^(?:rival|enemy)$/, /\brival\w*|\benem\w*|\bhates?\b/i],
  [/^(?:teammate|coach|player)$/, /\bteam\w*|\bcoach\w*|\bplay\w*\b/i],
  [/^(?:boss|employee|colleague)$/, /\bboss\b|\bwork\w*|\bjob\b|\bemploy\w*|\bcolleague/i],
  [/^(?:mentor|mentee)$/, /\bmentor\w*|\bteach\w*/i],
  [/^(?:roommate|neighbou?r|classmate)$/, /\broom\w*|\bneighbou?r\w*|\bclass\w*/i],
];

/**
 * The role the quote supports, or null: a family role becomes the family word the quote uses ("Grandma died" makes
 * "mother" a grandmother); any other role needs a word for it in the quote.
 */
export function supportedRole(roleWord: string, evidence: string): string | null {
  if (FAMILY.has(roleWord)) {
    const said = KIN.filter(([re]) => re.test(evidence)).map(([, r]) => r);
    if (said.length === 1) return said[0];
    return said.includes(roleWord) ? roleWord : null;
  }
  const rule = SUPPORT.find(([r]) => r.test(roleWord));
  return rule && rule[1].test(evidence) ? roleWord : null;
}

const role = (r: unknown) =>
  String(r ?? '')
    .trim()
    .toLowerCase()
    .replace(/^(?:the|a|an|his|her|their)\s+/, '');

/** Turns the model's answer into checked suggestions: "b is a's bToA" and "a is b's aToB". */
export function readRelations(answer: string, characters: readonly Char[], source: string): RelationSuggestion[] {
  let list: { person?: unknown; role?: unknown; of?: unknown; reverse?: unknown; evidence?: unknown }[] = [];
  try {
    list = (JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)) as { relations?: typeof list }).relations ?? [];
  } catch {
    return [];
  }
  const find = (name: unknown) => {
    const n = String(name ?? '').trim().toLowerCase();
    if (!n) return undefined;
    return (
      characters.find((c) => c.name.toLowerCase() === n || c.aliases.some((a) => a.toLowerCase() === n)) ??
      characters.find((c) => c.name.toLowerCase().split(/\s+/)[0] === n.split(/\s+/)[0])
    );
  };
  const out: RelationSuggestion[] = [];
  for (const r of list) {
    // "person is the role of other": person = b (the one described), other = a.
    const b = find(r.person);
    const a = find(r.of);
    let evidence = String(r.evidence ?? '').trim();
    const asked = role(r.role);
    if (!a || !b || a.id === b.id || !(asked in RELATION_WORDS) || !quoted(evidence, source)) continue;
    const bToA = supportedRole(asked, evidence);
    if (!bToA) continue;
    const given = role(r.reverse);
    // The reverse follows the corrected role unless the model's own reverse still fits it.
    const aToB = bToA === asked && given && given in RELATION_WORDS ? given : RELATION_WORDS[bToA];
    if (evidence.length > 220) evidence = `${evidence.slice(0, 220).replace(/\s+\S*$/, '')}…`;
    if (a.links.some((l) => l.targetId === b.id && l.label.trim()) || b.links.some((l) => l.targetId === a.id && l.label.trim())) continue;
    if (out.some((x) => (x.aId === a.id && x.bId === b.id) || (x.aId === b.id && x.bId === a.id))) continue;
    out.push({ aId: a.id, bId: b.id, aName: a.name, bName: b.name, bToA, aToB, evidence });
  }
  return out;
}

export async function suggestRelationships(characters: readonly Char[], source: string, opts: Pick<ChatOptions, 'signal' | 'fetchImpl'> = {}): Promise<RelationSuggestion[]> {
  return readRelations(await chat(relationMessages(source), { ...opts, temperature: 0.1, maxTokens: 900, schema: SCHEMA }), characters, source);
}
