/**
 * Tense slips: narration that drifts from the scene's tense ("I stepped inside… As I arrive on the floor, I make my
 * way out"). Only narration counts: dialogue, text messages ("Me: Hey…") and outline notes are skipped. Each verb
 * right after a narrator-like subject (I, we, he, she, they, a character's first name) is read as past or present;
 * the scene's main tense is whichever has more. The first verb of every stretch in the other tense is marked, so a
 * long present-tense passage gives one mark where it starts, not one per verb. Pure.
 */

export type Tense = 'past' | 'present';

export interface TenseSlip {
  block: number;
  start: number;
  end: number;
  word: string;
  tense: Tense;
  /** The scene's main tense. */
  main: Tense;
  /** How many tensed verbs in a row the stretch runs before the scene goes back to its main tense. */
  run: number;
  /** The verb in the scene's tense, when it can be worked out. */
  replacement: string | null;
}

/** A scene needs this many tensed narration verbs before its main tense is trusted. */
export const MIN_VERBS = 8;
/** And its main tense must hold at least this share of them. */
export const MIN_SHARE = 0.55;

const IRREGULAR: Record<string, string> = {
  am: 'was', is: 'was', are: 'were', have: 'had', has: 'had', do: 'did', does: 'did', go: 'went', goes: 'went',
  get: 'got', make: 'made', take: 'took', come: 'came', see: 'saw', know: 'knew', think: 'thought', say: 'said',
  tell: 'told', find: 'found', give: 'gave', feel: 'felt', leave: 'left', keep: 'kept', hold: 'held', stand: 'stood',
  sit: 'sat', run: 'ran', bring: 'brought', buy: 'bought', catch: 'caught', teach: 'taught', fight: 'fought',
  seek: 'sought', begin: 'began', drink: 'drank', ring: 'rang', sing: 'sang', sink: 'sank', swim: 'swam',
  shrink: 'shrank', spring: 'sprang', write: 'wrote', ride: 'rode', rise: 'rose', drive: 'drove', speak: 'spoke',
  break: 'broke', choose: 'chose', wake: 'woke', freeze: 'froze', steal: 'stole', wear: 'wore', tear: 'tore',
  swear: 'swore', bear: 'bore', grow: 'grew', throw: 'threw', blow: 'blew', fly: 'flew', draw: 'drew', eat: 'ate',
  fall: 'fell', forget: 'forgot', forgive: 'forgave', hide: 'hid', bite: 'bit', lose: 'lost', mean: 'meant',
  meet: 'met', pay: 'paid', lay: 'laid', lie: 'lay', lead: 'led', read: 'read', send: 'sent', spend: 'spent',
  lend: 'lent', bend: 'bent', build: 'built', sleep: 'slept', sweep: 'swept', weep: 'wept', creep: 'crept',
  kneel: 'knelt', hear: 'heard', sell: 'sold', shoot: 'shot', shake: 'shook', shine: 'shone', slide: 'slid',
  sling: 'slung', stick: 'stuck', sting: 'stung', strike: 'struck', swing: 'swung', win: 'won', understand: 'understood',
  wind: 'wound', dig: 'dug', feed: 'fed', bleed: 'bled', flee: 'fled', grind: 'ground', hang: 'hung', light: 'lit',
  put: 'put', set: 'set', let: 'let', cut: 'cut', hit: 'hit', hurt: 'hurt', shut: 'shut', quit: 'quit', cost: 'cost',
  spread: 'spread', burst: 'burst', cast: 'cast', become: 'became', overhear: 'overheard', undo: 'undid',
};
const PAST_FORMS = new Set(Object.values(IRREGULAR).concat(['was', 'were', 'did', 'had', 'didn’t', "didn't", 'wasn’t', "wasn't", 'weren’t', "weren't", 'hadn’t', "hadn't"]));
// Past forms that are also present (put, set, read…) say nothing about tense.
const SAME = new Set(Object.entries(IRREGULAR).filter(([a, b]) => a === b).map(([a]) => a));
const PRESENT_AUX = new Set(['am', 'is', 'are', 'do', 'does', 'have', 'has', 'don’t', "don't", 'doesn’t', "doesn't", 'isn’t', "isn't", 'aren’t', "aren't", 'haven’t', "haven't", 'hasn’t', "hasn't"]);
// Modals, future and contractions that hide the verb: no tense of their own.
const NEUTRAL = new Set(['will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'ought', 'won’t', "won't", 'can’t', "can't", 'couldn’t', "couldn't", 'wouldn’t', "wouldn't", 'shouldn’t', "shouldn't", 'need', 'used', 'too', 'and', 'or', 'but', 'myself', 'himself', 'herself', 'themselves', 'ourselves', 'alone', 'both', 'all', 'who', 'that']);
// Words that can sit between the subject and its verb ("I quietly reach", "she still holds").
const BETWEEN = new Set(['just', 'still', 'almost', 'never', 'always', 'also', 'only', 'even', 'then', 'soon', 'already', 'again', 'now', 'once', 'often', 'sometimes', 'nearly', 'finally', 'barely', 'hardly', 'instead', 'quickly', 'slowly']);
const LY_VERBS = new Set(['reply', 'apply', 'rely', 'supply', 'imply', 'comply', 'multiply', 'fly', 'ally', 'bully', 'rally', 'tally', 'sully', 'dally']);
// -ed words that aren't past verbs.
const NOT_PAST = new Set(['need', 'feed', 'bleed', 'speed', 'heed', 'breed', 'seed', 'weed', 'proceed', 'succeed', 'exceed', 'shed', 'bed', 'red', 'wed']);
const SUBJECTS = new Set(['i', 'we', 'he', 'she', 'they']);
const SINGULAR = new Set(['he', 'she']);
// First words of place and thing names ("The Book Shop") that aren't a character's name.
const NOT_NAMES = new Set(['the', 'a', 'an', 'my', 'our', 'his', 'her', 'their', 'old', 'new', 'saint', 'st', 'mr', 'mrs', 'ms', 'dr', 'mount', 'lake', 'fort', 'port', 'north', 'south', 'east', 'west', 'great', 'little', 'big']);

const WORD = /[\p{L}][\p{L}'’]*/gu;

/** Narration only: dialogue in quotes (to its closing quote, or the paragraph's end) is blanked out, keeping offsets. */
function narration(text: string): string {
  if (/^\s*[-*•–]\s/.test(text)) return ' '.repeat(text.length); // outline note
  if (/^\s*[\p{L}][\p{L} ]{0,20}:\s/u.test(text)) return ' '.repeat(text.length); // "Me: Hey, Grandma…"
  return text.replace(/["“][^"”]*(?:["”]|$)/g, (q) => ' '.repeat(q.length));
}

function tenseOf(word: string, singular: boolean): Tense | null {
  const w = word.toLowerCase();
  if (NEUTRAL.has(w) || SAME.has(w)) return null;
  if (PAST_FORMS.has(w)) return 'past';
  if (PRESENT_AUX.has(w)) return 'present';
  if (/'|’/.test(w)) return null;
  if (/ed$/.test(w) && w.length > 3 && !NOT_PAST.has(w)) return 'past';
  if (singular) return /[^su]s$/.test(w) || /(?:ches|shes|sses|xes|zzes|ies|oes)$/.test(w) ? 'present' : null;
  return 'present';
}

/** "reach" → "reached", "rub" → "rubbed", "picks" → "picked", "is" → "was". Null when unsure. */
export function toPast(word: string, singular: boolean): string | null {
  const lower = word.toLowerCase();
  let base = lower;
  if (singular && !IRREGULAR[lower]) {
    if (/ies$/.test(lower)) base = lower.slice(0, -3) + 'y';
    else if (/(?:ches|shes|sses|xes|zzes|oes)$/.test(lower)) base = lower.slice(0, -2);
    else if (/s$/.test(lower)) base = lower.slice(0, -1);
  }
  let past = IRREGULAR[base] ?? IRREGULAR[lower];
  if (!past) {
    if (PRESENT_AUX.has(lower) || NEUTRAL.has(lower)) return null;
    if (/e$/.test(base)) past = base + 'd';
    else if (/[^aeiou]y$/.test(base)) past = base.slice(0, -1) + 'ied';
    else if (/^[^aeiou]*[aeiou][bdgmnprt]$/.test(base)) past = base + base.slice(-1) + 'ed';
    else past = base + 'ed';
  }
  return word[0] === word[0].toUpperCase() ? past[0].toUpperCase() + past.slice(1) : past;
}

interface Verb {
  block: number;
  start: number;
  end: number;
  word: string;
  tense: Tense;
  singular: boolean;
}

/** Every tensed narration verb, in reading order. `names` are characters' names; their first word counts as a subject. */
export function narrationVerbs(texts: readonly string[], names: readonly string[] = []): Verb[] {
  const firstNames = new Set(names.map((n) => n.trim().split(/\s+/)[0]?.toLowerCase()).filter((n) => n && n.length > 1 && !NOT_NAMES.has(n)));
  const out: Verb[] = [];
  texts.forEach((text, block) => {
    const words = [...narration(text).matchAll(WORD)];
    for (let i = 0; i < words.length - 1; i++) {
      const raw = words[i][0];
      const lw = raw.toLowerCase();
      const isName = firstNames.has(lw) && raw[0] !== lw[0];
      if (!SUBJECTS.has(lw) && !isName) continue;
      if (lw === 'i' && raw !== 'I') continue;
      let j = i + 1;
      // Only when nothing but a space separates the words: "I, too," or "she." aren't subject + verb.
      const gap = (a: number, b: number) => text.slice(words[a].index! + words[a][0].length, words[b].index!);
      while (j < words.length && /^\s+$/.test(gap(j - 1, j)) && (BETWEEN.has(words[j][0].toLowerCase()) || (/ly$/i.test(words[j][0]) && words[j][0].length > 4 && !LY_VERBS.has(words[j][0].toLowerCase())))) j++;
      if (j >= words.length || !/^\s+$/.test(gap(j - 1, j))) continue;
      const w = words[j][0];
      // A capitalised word after a name is more name ("Jace Kensington"), not a verb.
      if (w[0] !== w[0].toLowerCase()) continue;
      const singular = SINGULAR.has(lw) || isName;
      const tense = tenseOf(w, singular);
      if (tense) out.push({ block, start: words[j].index!, end: words[j].index! + w.length, word: w, tense, singular });
    }
  });
  return out;
}

/** The start of each stretch of narration in the other tense from the scene's main one. */
export function findTenseSlips(texts: readonly string[], names: readonly string[] = []): TenseSlip[] {
  const verbs = narrationVerbs(texts, names);
  if (verbs.length < MIN_VERBS) return [];
  const past = verbs.filter((v) => v.tense === 'past').length;
  const main: Tense = past * 2 >= verbs.length ? 'past' : 'present';
  const share = (main === 'past' ? past : verbs.length - past) / verbs.length;
  if (share < MIN_SHARE || share === 1) return [];
  const out: TenseSlip[] = [];
  for (let i = 0; i < verbs.length; i++) {
    const v = verbs[i];
    if (v.tense === main || (i > 0 && verbs[i - 1].tense === v.tense)) continue;
    let run = 1;
    while (i + run < verbs.length && verbs[i + run].tense === v.tense) run++;
    const replacement = main === 'past' ? toPast(v.word, v.singular) : null;
    out.push({ block: v.block, start: v.start, end: v.end, word: v.word, tense: v.tense, main, run, replacement });
  }
  return out;
}

export function tenseSlipMessage(s: TenseSlip): string {
  const stretch = s.run > 1 ? ` The next ${s.run - 1} verb${s.run === 2 ? '' : 's'} after it stay${s.run === 2 ? 's' : ''} in the ${s.tense} tense too.` : '';
  return `This scene is mostly told in the ${s.main} tense, but “${s.word}” is ${s.tense} tense.${stretch} If the switch isn’t on purpose, put it back in the ${s.main} tense.`;
}
