import { synonymsFor } from './synonyms';
import { strongerWords } from './stronger';
import { levenshtein } from '../domain/text';
import { SEVERITY_RANK, type Category, type ProofreadContext, type Severity, type Suggestion } from './types';

export const LOCAL_PROVIDER_ID = 'local-rules';

interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  run(text: string, ctx: ProofreadContext): Omit<Suggestion, 'providerId' | 'ruleId' | 'category' | 'severity'>[];
}

type Hit = ReturnType<Rule['run']>[number];

function matchCase(source: string, replacement: string): string {
  if (source === source.toUpperCase() && source.length > 1) return replacement.toUpperCase();
  if (source[0] && source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** Build a rule from a regex. `fix` receives the match and returns replacement(s) for match[0] or null to skip. */
function regexRule(
  id: string,
  category: Category,
  severity: Severity,
  re: RegExp,
  message: string | ((m: RegExpExecArray) => string),
  fix: (m: RegExpExecArray, text: string) => string[] | null,
  span?: (m: RegExpExecArray) => [number, number],
): Rule {
  // Compiled once; rules run synchronously, so resetting lastIndex per call is safe.
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  return {
    id,
    category,
    severity,
    run(text) {
      const out: Hit[] = [];
      r.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = r.exec(text))) {
        if (m[0].length === 0) {
          r.lastIndex++;
          continue;
        }
        const reps = fix(m, text);
        if (reps === null) continue;
        const [s, e] = span ? span(m) : [m.index, m.index + m[0].length];
        out.push({
          start: s,
          end: e,
          original: text.slice(s, e),
          replacements: reps,
          message: typeof message === 'string' ? message : message(m),
        });
      }
      return out;
    },
  };
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e', 'prof', 'gen', 'capt', 'lt', 'sgt', 'col', 'rev', 'mt', 'no', 'vol', 'fig', 'approx',
]);

/** [stable id, pattern, replacement, explanation, label]. Ids are stored in settings when a check is turned off; never renumber. */
const CONFUSED: [string, RegExp, string, string, string][] = [
  ['confused-modal-of', /\b(could|would|should|must|might|may) of\b/i, '$1 have', '“of” is a mishearing of “have” here.', '“could of” → “could have”'],
  ['confused-alot', /\balot\b/i, 'a lot', '“A lot” is two words.', '“alot” → “a lot”'],
  ['confused-then-than', /\b(more|less|better|worse|rather|other|greater|fewer|bigger|smaller|faster|slower|older|younger|larger|higher|lower|taller|stronger|weaker) then\b/i, '$1 than', 'Use “than” for comparisons.', '“more then” → “more than”'],
  ['confused-your-welcome', /\byour welcome\b/i, "you're welcome", 'Did you mean “you’re” (you are)?', '“your welcome” → “you’re welcome”'],
  // Not "its time/true/only/all/over": "its true name", "its time had come" are correct possessives.
  ['confused-its-it-is', /\bits (a|an|the|been|not|going|okay|ok|just|so|too|very|no)\b/i, "it's $1", 'Did you mean “it’s” (it is / it has)?', '“its a” → “it’s a”'],
  ['confused-its-own', /\bit'?s own\b/i, 'its own', 'Possessive “its” has no apostrophe.', '“it’s own” → “its own”'],
  ['confused-their-there', /\btheir (is|are|was|were)\b/i, 'there $1', 'Did you mean “there”?', '“their is” → “there is”'],
  ['confused-suppose-to', /\bsuppose to\b/i, 'supposed to', 'Use “supposed to”.', '“suppose to” → “supposed to”'],
  // "to loose an arrow" is correct (to let fly), so skip arrows, bolts and the like.
  [
    'confused-loose-lose',
    /\b(to|will|would|could|might|not|don't|didn't|never) loose\b(?!\s+(?:(?:an?|the|his|her|their|my|your|our|another|one|a few)\s+)?(?:arrows?|bolts?|shafts?|volleys?|quarrels?|darts?|hounds?|dogs?|hawks?|falcons?|spells?))/i,
    '$1 lose',
    '“Loose” means not tight; “lose” means to misplace or be defeated.',
    '“to loose” → “to lose”',
  ],
  ['confused-breath-breathe', /\b(to|could|couldn't|can't|cannot) breath\b/i, '$1 breathe', '“Breath” is the noun; the verb is “breathe”.', '“to breath” → “to breathe”'],
  ['confused-lead-led', /\b(had|has|have) lead\b/i, '$1 led', 'The past participle of “lead” is “led”.', '“had lead” → “had led”'],
  ['confused-affect-effect', /\b(an|the) affect\b/i, '$1 effect', '“Effect” is usually the noun; “affect” is usually the verb.', '“the affect” → “the effect”'],
  ['confused-piqued', /\bpeaked (my|his|her|their|your|our) (interest|curiosity)\b/i, 'piqued $1 $2', 'Interest is “piqued”.', '“peaked my interest” → “piqued”'],
  ['confused-intents-purposes', /\bfor all intensive purposes\b/i, 'for all intents and purposes', 'The idiom is “for all intents and purposes”.', '“all intensive purposes”'],
  ['confused-whether', /\bweather or not\b/i, 'whether or not', 'Use “whether” for alternatives.', '“weather or not” → “whether or not”'],
  ['confused-per-se', /\bper say\b/i, 'per se', 'The Latin phrase is “per se”.', '“per say” → “per se”'],
  ['confused-free-rein', /\bfree reign\b/i, 'free rein', 'The idiom is “free rein”.', '“free reign” → “free rein”'],
  ['confused-sneak-peek', /\bsneak peak\b/i, 'sneak peek', 'A quick look is a “peek”.', '“sneak peak” → “sneak peek”'],
  ['confused-throughout', /\bthrough out\b/i, 'throughout', '“Throughout” is one word.', '“through out” → “throughout”'],
  ['confused-bated-breath', /\bbaited breath\b/i, 'bated breath', 'The idiom is “bated breath” (held, abated).', '“baited breath” → “bated breath”'],
  ['confused-toe-the-line', /\btow(s|ed|ing)? the line\b/i, 'toe$1 the line', 'The idiom is “toe the line”.', '“tow the line” → “toe the line”'],
  ['confused-one-and-the-same', /\bone in the same\b/i, 'one and the same', 'The phrase is “one and the same”.', '“one in the same”'],
  ['confused-deep-seated', /\bdeep[- ]seeded\b/i, 'deep-seated', 'The phrase is “deep-seated”.', '“deep seeded” → “deep-seated”'],
  ['confused-shoo-in', /\bshoe[- ]in\b/i, 'shoo-in', 'A sure winner is a “shoo-in”.', '“shoe-in” → “shoo-in”'],
  ['confused-irregardless', /\birregardless\b/i, 'regardless', '“Irregardless” is widely considered nonstandard; “regardless” says the same thing.', '“irregardless” → “regardless”'],
  ['confused-wreak-havoc', /\b(wreck|reek)(s|ed|ing)? havoc\b/i, 'wreak$2 havoc', 'The phrase is “wreak havoc”.', '“wreck havoc” → “wreak havoc”'],
  ['confused-sneak-a-peek', /\b(sneak|take|took|taking|have|had|get|got|catch|caught) a peak\b/i, '$1 a peek', 'A quick look is a “peek”; a “peak” is a summit.', '“sneak a peak” → “sneak a peek”'],
  ['confused-could-care-less', /\b(I|you|we|they|he|she) could care less\b/i, "$1 couldn't care less", 'The idiom is “couldn’t care less” (it can’t get any lower).', '“could care less” → “couldn’t care less”'],
  ['confused-make-do', /\bmake due\b/i, 'make do', 'The phrase is “make do”.', '“make due” → “make do”'],
  ['confused-case-in-point', /\bcase and point\b/i, 'case in point', 'The phrase is “case in point”.', '“case and point” → “case in point”'],
  ['confused-moot-point', /\bmute point\b/i, 'moot point', 'An irrelevant point is “moot”.', '“mute point” → “moot point”'],
  ['confused-sleight-of-hand', /\bslight of hand\b/i, 'sleight of hand', 'Trickery is “sleight of hand”.', '“slight of hand” → “sleight of hand”'],
  ['confused-tongue-in-cheek', /\btongue and cheek\b/i, 'tongue in cheek', 'The phrase is “tongue in cheek”.', '“tongue and cheek” → “tongue in cheek”'],
  ['confused-scapegoat', /\bescape goat\b/i, 'scapegoat', '“Scapegoat” is one word.', '“escape goat” → “scapegoat”'],
  ['confused-all-of-a-sudden', /\ball of the sudden\b/i, 'all of a sudden', 'The phrase is “all of a sudden”.', '“all of the sudden” → “all of a sudden”'],
  ['confused-whet-appetite', /\bwet (my|your|his|her|their|our|the) appetite\b/i, 'whet $1 appetite', 'To sharpen an appetite is to “whet” it.', '“wet your appetite” → “whet”'],
  ['confused-beck-and-call', /\bbeckon call\b/i, 'beck and call', 'The phrase is “beck and call”.', '“beckon call” → “beck and call”'],
  ['confused-dog-eat-dog', /\bdoggy[- ]dog world\b/i, 'dog-eat-dog world', 'The phrase is “dog-eat-dog world”.', '“doggy dog world”'],
  ['confused-exact-revenge', /\bextract(s|ed|ing)? revenge\b/i, 'exact$1 revenge', 'Revenge is “exacted”.', '“extract revenge” → “exact revenge”'],
  ['confused-hunger-pangs', /\bhunger pains\b/i, 'hunger pangs', 'The phrase is “hunger pangs”.', '“hunger pains” → “hunger pangs”'],
  ['confused-faze', /\b(didn['’]t|doesn['’]t|don['’]t|won['’]t|never|not) phase\b/i, '$1 faze', 'To unsettle someone is to “faze” them.', '“didn’t phase me” → “faze”'],
  ['confused-rein-in', /\breign(s|ed|ing)? in\b/i, 'rein$1 in', 'To restrain is to “rein in”, like a horse.', '“reign in” → “rein in”'],
  ['confused-uncharted', /\bunchartered\b/i, 'uncharted', 'Unmapped territory is “uncharted”.', '“unchartered” → “uncharted”'],
  ['confused-supposedly', /\bsupposably\b/i, 'supposedly', 'The word is “supposedly”.', '“supposably” → “supposedly”'],
  ['confused-espresso', /\bexpresso\b/i, 'espresso', 'The coffee is “espresso”.', '“expresso” → “espresso”'],
  ['confused-prima-donna', /\bpre[- ]?madonna\b/i, 'prima donna', 'The phrase is “prima donna”.', '“pre-Madonna” → “prima donna”'],
  ['confused-home-in', /\bhon(e|ed|es|ing) in on\b/i, 'hom$1 in on', 'To close in on a target is to “home in on” it.', '“hone in on” → “home in on”'],
  ['confused-first-served', /\bfirst come,? first serve\b/i, 'first come, first served', 'The phrase is “first come, first served”.', '“first serve” → “first served”'],
  ['confused-statute', /\bstatue of limitations\b/i, 'statute of limitations', 'A law is a “statute”.', '“statue of limitations”'],
  ['confused-by-accident', /\bon accident\b/i, 'by accident', 'The standard phrase is “by accident”.', '“on accident” → “by accident”'],
];

/** Ids used before the confused-word checks had names (index into the old list). */
const LEGACY_RULE_IDS: Record<string, string> = {
  'confused-0': 'confused-modal-of', 'confused-1': 'confused-alot', 'confused-2': 'confused-then-than', 'confused-3': 'confused-your-welcome',
  'confused-4': 'confused-its-it-is', 'confused-5': 'confused-its-own', 'confused-6': 'confused-their-there', 'confused-7': 'confused-suppose-to',
  'confused-8': 'confused-loose-lose', 'confused-9': 'confused-breath-breathe', 'confused-10': 'confused-lead-led', 'confused-11': 'confused-affect-effect',
  'confused-12': 'confused-piqued', 'confused-13': 'confused-intents-purposes', 'confused-14': 'confused-modal-of', 'confused-15': 'confused-whether',
  'confused-16': 'confused-per-se', 'confused-17': 'confused-free-rein', 'confused-18': 'confused-sneak-peek', 'confused-19': 'confused-modal-of',
  'confused-20': 'confused-throughout',
};

export function normalizeRuleId(id: string): string {
  return LEGACY_RULE_IDS[id] ?? id;
}

const MISSPELLINGS: Record<string, string> = {
  recieve: 'receive', recieved: 'received', seperate: 'separate', definately: 'definitely', occured: 'occurred',
  untill: 'until', wierd: 'weird', accomodate: 'accommodate', beleive: 'believe', goverment: 'government',
  tommorow: 'tomorrow', tomorow: 'tomorrow', truely: 'truly', arguement: 'argument', begining: 'beginning',
  calender: 'calendar', existance: 'existence', foriegn: 'foreign', happend: 'happened', independant: 'independent',
  neccessary: 'necessary', noticable: 'noticeable', occassion: 'occasion', persistant: 'persistent',
  posession: 'possession', publically: 'publicly', refered: 'referred', relevent: 'relevant', succesful: 'successful',
  suprise: 'surprise', thier: 'their', tounge: 'tongue', wich: 'which', writting: 'writing', acheive: 'achieve',
  teh: 'the', adn: 'and', becuase: 'because', freind: 'friend',
  // Contractions typed without the apostrophe (not cant/wont/hell/shell/well, which are words).
  dont: "don't", didnt: "didn't", doesnt: "doesn't", isnt: "isn't", wasnt: "wasn't", werent: "weren't", arent: "aren't",
  couldnt: "couldn't", wouldnt: "wouldn't", shouldnt: "shouldn't", havent: "haven't", hasnt: "hasn't", hadnt: "hadn't",
  mustnt: "mustn't", neednt: "needn't", youre: "you're", theyre: "they're", thats: "that's", whats: "what's", theres: "there's",
};

// Not gray/grey (both are standard in US fiction) or meter/metre (a "gas meter" is "meter" in the UK too).
const US_UK: [string, string][] = [
  ['color', 'colour'], ['honor', 'honour'], ['favorite', 'favourite'], ['realize', 'realise'], ['center', 'centre'],
  ['theater', 'theatre'], ['traveled', 'travelled'], ['traveling', 'travelling'], ['traveler', 'traveller'], ['defense', 'defence'],
  ['armor', 'armour'], ['neighbor', 'neighbour'], ['behavior', 'behaviour'], ['harbor', 'harbour'],
  ['rumor', 'rumour'], ['labor', 'labour'], ['flavor', 'flavour'], ['valor', 'valour'], ['splendor', 'splendour'],
  ['vigor', 'vigour'], ['clamor', 'clamour'], ['savior', 'saviour'], ['endeavor', 'endeavour'],
  ['organize', 'organise'], ['recognize', 'recognise'], ['apologize', 'apologise'], ['realization', 'realisation'], ['organization', 'organisation'],
  ['plow', 'plough'], ['mold', 'mould'], ['jewelry', 'jewellery'], ['pajamas', 'pyjamas'],
  ['canceled', 'cancelled'], ['offense', 'offence'], ['skeptical', 'sceptical'], ['catalog', 'catalogue'],
];

/** Every inflected form of a US/UK pair: colors, coloured, realising, honourable… */
function inflections(base: string): string[] {
  // Same shape for both spellings so forms line up by index (centre/centred ↔ center/centered).
  const forms = [base, base + 's'];
  if (base.endsWith('e')) forms.push(base + 'd', base.slice(0, -1) + 'ing');
  else forms.push(base + 'ed', base + 'ing');
  if (/ou?r$/.test(base)) forms.push(base + 'ful', base + 'able', base + 'less');
  return forms;
}

const dialectMaps = new Map<string, Map<string, string>>();
/** wrong form → right form for the chosen dialect, built once. */
function dialectMap(dialect: 'en-US' | 'en-GB'): Map<string, string> {
  let map = dialectMaps.get(dialect);
  if (!map) {
    map = new Map();
    for (const [us, uk] of US_UK) {
      const [wrong, right] = dialect === 'en-US' ? [uk, us] : [us, uk];
      const w = inflections(wrong);
      const r = inflections(right);
      w.forEach((form, i) => {
        if (r[i] && !map!.has(form) && form !== r[i]) map!.set(form, r[i]);
      });
    }
    dialectMaps.set(dialect, map);
  }
  return map;
}

const SAID_VERBS =
  'said|asked|whispered|replied|shouted|muttered|called|answered|cried|murmured|yelled|snapped|added|continued|explained|admitted|insisted|agreed|lied|sighed|laughed';

export const ADVERB_EXCEPTIONS = new Set([
  'only', 'family', 'early', 'reply', 'ally', 'fly', 'holy', 'ugly', 'lovely', 'friendly', 'belly', 'jelly', 'italy',
  'supply', 'apply', 'rely', 'july', 'lily', 'bully', 'silly', 'daily', 'likely', 'lonely', 'elderly', 'deadly',
  'costly', 'curly', 'hilly', 'oily', 'smelly', 'chilly', 'jolly', 'molly', 'polly', 'sally', 'kelly', 'emily',
  'beverly', 'reilly', 'wily', 'surly', 'burly', 'comply', 'imply', 'multiply', 'rally', 'tally', 'gully', 'folly',
  'holly', 'dolly', 'anomaly', 'assembly', 'monopoly', 'homily', 'ghostly', 'heavenly', 'kindly', 'orderly',
  'scholarly', 'sickly', 'leisurely', 'manly', 'womanly', 'worldly', 'cowardly', 'timely', 'stately', 'weekly',
  'monthly', 'yearly', 'hourly', 'nightly', 'quarterly', 'unlikely', 'ugly', 'firefly', 'butterfly', 'dragonfly',
]);

const STOP_WORDS = new Set(['the', 'and', 'of', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'old', 'new', 'great', 'little', 'big', 'house', 'point', 'light', 'lamp', 'river', 'city', 'town', 'street', 'road', 'hill', 'lake', 'sea', 'north', 'south', 'east', 'west', 'saint', 'mount', 'castle', 'tower']);

const FILLER = /\b(very|really|suddenly|somehow|literally|basically|actually|totally|quite|rather|just)\b/i;

const CLICHES = [
  'at the end of the day', 'in the nick of time', 'all of a sudden', 'avoid like the plague', 'cold as ice',
  'dead as a doornail', 'heart of gold', 'in the blink of an eye', 'let the cat out of the bag', 'only time will tell',
  'scared to death', 'time stood still', 'without further ado', 'a chill ran down', 'let out a breath',
  'released a breath', "didn't know (?:she|he|they) (?:was|were) holding",
];

const CLICHE_RES = CLICHES.map((c) => new RegExp(`\\b${c}`, 'gi'));

interface NameTables {
  names: Map<string, string>;
  lowercaseFlag: Set<string>;
  /** Name parts grouped by first letter, for the fuzzy comparison. */
  byInitial: Map<string, [string, string][]>;
}
const nameTableCache = new WeakMap<readonly string[], NameTables>();

/** Lookup tables for the reference names; cached per names list (one per proofreading run, shared by every block). */
function nameTables(knownNames: readonly string[]): NameTables {
  let t = nameTableCache.get(knownNames);
  if (t) return t;
  const names = new Map<string, string>();
  const lowercaseFlag = new Set<string>();
  for (const n of knownNames) {
    const parts = n.split(/\s+/).filter((p) => p.length >= 3 && !STOP_WORDS.has(p.toLowerCase()));
    for (const part of parts) names.set(part.toLowerCase(), part);
    // "elara" is worth flagging; "lamp" from "The Salt Lamp" is not.
    const tokens = n.split(/\s+/);
    if (tokens.length === 1 && tokens[0].length >= 3) lowercaseFlag.add(tokens[0].toLowerCase());
    else if (tokens[0] && !STOP_WORDS.has(tokens[0].toLowerCase()) && tokens[0].length >= 3) lowercaseFlag.add(tokens[0].toLowerCase());
  }
  const byInitial = new Map<string, [string, string][]>();
  for (const [k, v] of names) {
    const list = byInitial.get(k[0]) ?? [];
    list.push([k, v]);
    byInitial.set(k[0], list);
  }
  t = { names, lowercaseFlag, byInitial };
  nameTableCache.set(knownNames, t);
  return t;
}

export const RULES: Rule[] = [
  // Flags the second occurrence only: "Remove" drops it (and its space); otherwise swap in a different word.
  regexRule(
    'repeated-word',
    'repetition',
    'error',
    /(?<![\p{L}\p{N}'’])([\p{L}'’]+)(\s+)(\1)(?![\p{L}\p{N}'’])/iu,
    (m) =>
      synonymsFor(m[3]).length
        ? `“${m[1]}” appears twice in a row. Remove the repeat, or use a different word.`
        : `“${m[1]}” appears twice in a row. Remove the repeat.`,
    (m) => {
      const w = m[1].toLowerCase();
      if (w === 'had' || w === 'that' || w === 'is' || w === 'bye' || w === 'no' || w === 'very' || w === 'knock') return null;
      return ['', ...synonymsFor(m[3])];
    },
    (m) => [m.index + m[1].length + m[2].length, m.index + m[0].length],
  ),
  regexRule('double-space', 'punctuation', 'warning', / {2,}/, 'Extra space.', (m, t) =>
    m.index === 0 || t[m.index - 1] === '\n' ? null : [' '],
  ),
  regexRule('space-before-punct', 'punctuation', 'error', /[ \t]+([,.;:!?])(?![.\d])/, 'Remove the space before punctuation.', (m) => [m[1]]),
  regexRule('space-after-punct', 'punctuation', 'warning', /([,;])(?=[\p{L}])/u, 'Add a space after punctuation.', (m) => [m[1] + ' ']),
  regexRule(
    'space-after-sentence',
    'punctuation',
    'warning',
    /([a-z]{2,})([.!?])(?=[A-Z][a-z])/,
    'Add a space after the end of a sentence.',
    (m) => [m[1] + m[2] + ' '],
  ),
  regexRule(
    'sentence-capital',
    'capitalization',
    'error',
    /(\S*)([.!?])(\s+)([a-z])/,
    'Start a sentence with a capital letter.',
    (m, text) => {
      const prev = m[1].replace(/^[("'“‘]+/, '').toLowerCase();
      if (ABBREVIATIONS.has(prev) || /\.\w/.test(prev) || /\.\.$/.test(m[1] + m[2])) return null;
      if (m[2] === '.' && /^\d+$/.test(prev)) return null;
      if (text.slice(m.index + m[0].length - 1).startsWith('e.g') || text.slice(m.index + m[0].length - 1).startsWith('i.e')) return null;
      return [m[4].toUpperCase()];
    },
    (m) => [m.index + m[0].length - 1, m.index + m[0].length],
  ),
  regexRule('lowercase-i', 'capitalization', 'error', /(?<![\p{L}\p{N}.'’-])i(?=['’](?:m|d|ll|ve)\b|(?![\p{L}\p{N}.'’-]))/u, 'The pronoun “I” is always capitalized.', () => ['I']),
  regexRule('first-capital', 'capitalization', 'warning', /^(["“‘']?)([a-z])/, 'Start the paragraph with a capital letter.', (m) => [m[1] + m[2].toUpperCase()]),
  ...CONFUSED.map(([id, re, rep, msg]) => {
    const single = new RegExp(re.source, 'i');
    return regexRule(id, 'confused', 'warning', re, msg, (m) => [matchCase(m[0], m[0].replace(single, rep))]);
  }),
  regexRule('a-an-vowel', 'grammar', 'warning', /\b(a) ([aeiou][\p{L}]*)/iu, 'Use “an” before a vowel sound.', (m) => {
    if (/^(one|once|uni|use|usu|usa|uto|ufo|eu|ewe|ur|uti|ubiq|uk)/i.test(m[2])) return null;
    return [matchCase(m[1], 'an') + ' ' + m[2]];
  }),
  regexRule('an-a-consonant', 'grammar', 'warning', /\b(an) ([b-df-hj-np-tv-z][\p{L}]*)/iu, 'Use “a” before a consonant sound.', (m) => {
    if (/^(hour|honest|honou?r|heir|herb)/i.test(m[2])) return null;
    // Acronyms and letters are read aloud: "an FBI agent", "an X-ray", "an MRI".
    if (m[2].length === 1 || /^[\p{Lu}]{2,}$/u.test(m[2])) return null;
    return [matchCase(m[1], 'a') + ' ' + m[2]];
  }),
  regexRule('common-misspelling', 'spelling', 'error', /\b[\p{L}]+\b/u, (m) => `Possible misspelling of “${m[0]}”.`, (m) => {
    const fix = MISSPELLINGS[m[0].toLowerCase()];
    return fix ? [matchCase(m[0], fix)] : null;
  }),
  regexRule(
    'dialogue-period-before-tag',
    'dialogue',
    'warning',
    new RegExp(`\\.(["”])(\\s+)(he|she|they|I|we|you|it) (${SAID_VERBS})\\b`),
    'When dialogue is followed by a speech tag, end it with a comma instead of a period.',
    (m) => [',' + m[1]],
    (m) => [m.index, m.index + 2],
  ),
  regexRule(
    'dialogue-tag-capital',
    'dialogue',
    'warning',
    new RegExp(`([,?!]["”]\\s+)(He|She|They|We|You|It) (${SAID_VERBS})\\b`),
    'A speech tag after dialogue continues the sentence, so it starts in lowercase.',
    (m) => [m[2].toLowerCase()],
    (m) => [m.index + m[1].length, m.index + m[1].length + m[2].length],
  ),
  regexRule('dialogue-missing-comma', 'dialogue', 'warning', new RegExp(`(\\p{L})(["”])\\s+(he|she|they|I|we|you) (${SAID_VERBS})\\b`, 'u'), 'Dialogue followed by a speech tag usually needs a comma inside the quotes.', (m) => [m[1] + ',' + m[2]], (m) => [m.index, m.index + 2]),
  regexRule('ellipsis-spacing', 'punctuation', 'style', /\.{4,}/, 'An ellipsis has three dots.', () => ['...']),
  regexRule('multiple-punct', 'punctuation', 'style', /([!?]){2,}/, 'Repeated punctuation can feel loud in prose.', (m) => [m[1]]),
  {
    id: 'dialect',
    category: 'spelling',
    severity: 'warning',
    run(text, ctx) {
      const out: Hit[] = [];
      const map = dialectMap(ctx.dialect);
      const re = /[\p{L}]+/gu;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const right = map.get(m[0].toLowerCase());
        if (!right) continue;
        out.push({
          start: m.index,
          end: m.index + m[0].length,
          original: m[0],
          replacements: [matchCase(m[0], right)],
          message: `“${m[0]}” is the ${ctx.dialect === 'en-US' ? 'UK' : 'US'} spelling; your dictionary is set to ${ctx.dialect === 'en-US' ? 'US' : 'UK'} English.`,
        });
      }
      return out;
    },
  },
  {
    id: 'name-consistency',
    category: 'consistency',
    severity: 'warning',
    run(text, ctx) {
      const out: Hit[] = [];
      const { names, lowercaseFlag, byInitial } = nameTables(ctx.knownNames);
      if (!names.size) return out;
      const re = /\b[\p{L}][\p{L}'’-]{2,}\b/gu;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const word = m[0];
        const lower = word.toLowerCase();
        if (ctx.dictionary.has(lower)) continue;
        const exact = names.get(lower);
        if (exact) {
          // Known proper name written in lowercase, e.g. "elara".
          if (word !== exact && word === lower && exact !== lower && lowercaseFlag.has(lower)) {
            out.push({ start: m.index, end: m.index + word.length, original: word, replacements: [exact], message: `“${exact}” is capitalized in your reference library.` });
          }
          continue;
        }
        if (word[0] !== word[0].toUpperCase() || word[0] === word[0].toLowerCase()) continue;
        let best: string | null = null;
        let bestD = 99;
        for (const [k, v] of byInitial.get(lower[0]) ?? []) {
          if (Math.abs(k.length - lower.length) > 2) continue;
          const d = levenshtein(k, lower);
          const limit = k.length >= 6 ? 2 : 1;
          if (d > 0 && d <= limit && d < bestD) {
            best = v;
            bestD = d;
          }
        }
        if (best) {
          out.push({ start: m.index, end: m.index + word.length, original: word, replacements: [best], message: `Possible inconsistent spelling of “${best}”.` });
        }
      }
      return out;
    },
  },
  {
    id: 'repeated-sentence-start',
    category: 'clarity',
    severity: 'style',
    run(text) {
      const out: Hit[] = [];
      const re = /(?:^|[.!?]["”’]?\s+)(["“]?)([\p{L}']+)/gu;
      const starts: { word: string; index: number }[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const idx = m.index + m[0].length - m[2].length;
        starts.push({ word: m[2].toLowerCase(), index: idx });
      }
      for (let i = 2; i < starts.length; i++) {
        const w = starts[i].word;
        if (w === starts[i - 1].word && w === starts[i - 2].word) {
          out.push({ start: starts[i].index, end: starts[i].index + w.length, original: text.substr(starts[i].index, w.length), replacements: [], message: `Three sentences in a row start with “${text.substr(starts[i].index, w.length)}”. Consider varying the rhythm.` });
        }
      }
      return out;
    },
  },
  {
    id: 'long-sentence',
    category: 'clarity',
    severity: 'style',
    run(text) {
      const out: Hit[] = [];
      const re = /[^.!?]+[.!?]*/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const words = m[0].trim().split(/\s+/).filter(Boolean).length;
        if (words > 45) {
          const lead = m[0].length - m[0].trimStart().length;
          const s = m.index + lead;
          const firstWords = m[0].trim().split(/\s+/).slice(0, 3).join(' ');
          out.push({ start: s, end: s + firstWords.length, original: text.slice(s, s + firstWords.length), replacements: [], message: `This sentence is ${words} words long. Long sentences can be powerful; check that it reads clearly.` });
        }
      }
      return out;
    },
  },
  {
    id: 'stronger-word',
    // Clarity (on by default), not the optional style hints: every hit comes with concrete rewrites.
    category: 'clarity',
    severity: 'style',
    run: (text) => strongerWords(text),
  },
  // Speech tags that say the same thing twice: "whispered quietly", "shouted loudly", "replied back".
  regexRule(
    'dialogue-redundant-tag',
    'dialogue',
    'warning',
    /\b(whisper(?:ed|s|ing)?|murmur(?:ed|s|ing)?) (?:quietly|softly)\b|\b(shout(?:ed|s|ing)?|yell(?:ed|s|ing)?|scream(?:ed|s|ing)?|bellow(?:ed|s|ing)?) loudly\b|\b(repl(?:ied|ies|y|ying)|answer(?:ed|s|ing)?|respond(?:ed|s|ing)?) back\b/i,
    (m) => `“${m[0]}” says it twice: the verb already carries the meaning.`,
    (m) => [m[1] ?? m[2] ?? m[3]],
  ),
  {
    // Offers what to write instead: cut the adverb (tidying commas and capitals), or a synonym where one is known.
    id: 'adverb',
    category: 'style',
    severity: 'style',
    run(text) {
      const out: Hit[] = [];
      const re = /(?<![\p{L}'’-])[\p{L}]{4,}ly(?![\p{L}'’-])/gu;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const word = m[0];
        if (ADVERB_EXCEPTIONS.has(word.toLowerCase())) continue;
        const start = m.index;
        const end = start + word.length;
        const before = text.slice(0, start);
        const after = text.slice(end);
        const synonyms = synonymsFor(word);
        const message = `“${word}” is an adverb. Cutting it, or choosing a stronger verb, often reads better.`;
        const opener = /^(?:|[\s\S]*[.!?…]["”’)]*\s+|[\s\S]*["“‘]\s*)$/.test(before) ? /^,\s+(\p{L})/u.exec(after) : null;
        if (opener) {
          // "Unfortunately, the boat…" → "The boat…"
          const tail = opener[0];
          out.push({ start, end: end + tail.length, original: word + tail, replacements: [opener[1].toUpperCase(), ...synonyms.map((s) => s + tail)], message });
        } else if (/[\p{L}\p{N}],\s$/u.test(before) && after.startsWith(',')) {
          // "He was, unfortunately, late." → "He was late."
          out.push({ start: start - 2, end: end + 1, original: text.slice(start - 2, end + 1), replacements: ['', ...synonyms.map((s) => `, ${s},`)], message });
        } else if (/[\p{L}\p{N}]\s$/u.test(before) && /^(?:\s|[,.;:!?]|$)/.test(after)) {
          // "He ran quickly to the door." → "He ran to the door."
          out.push({ start, end, original: word, replacements: ['', ...synonyms], message });
        } else if (synonyms.length) {
          out.push({ start, end, original: word, replacements: synonyms, message });
        }
      }
      return out;
    },
  },
  regexRule('passive-voice', 'style', 'style', /\b(am|is|are|was|were|be|been|being)\s+([\p{L}]+ed|written|taken|given|seen|done|made|known|found|told|held|brought|thrown|driven|broken|chosen|forgotten|hidden|stolen)\b(?=\s+by\b)/u, 'Possible passive voice. Consider whether the actor should lead the sentence.', () => []),
  regexRule('filler-word', 'style', 'style', FILLER, (m) => `“${m[0]}” often adds little; consider cutting it.`, (m, text) => {
    // Offer to cut it mid-sentence only: cutting a sentence's first word would leave a lowercase start,
    // and "rather" often carries meaning ("rather than", "I'd rather").
    const midSentence = /[\p{Ll},;]\s+$/u.test(text.slice(0, m.index));
    return midSentence && m[0].toLowerCase() !== 'rather' ? [''] : [];
  }),
  {
    id: 'cliche',
    category: 'style',
    severity: 'style',
    run(text) {
      const out: Hit[] = [];
      for (const re of CLICHE_RES) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, original: m[0], replacements: [], message: 'Familiar phrase. Is there a fresher way to say it?' });
      }
      return out;
    },
  },
];

export const RULE_IDS = RULES.map((r) => r.id);

const RULE_LABELS: Record<string, string> = {
  'repeated-word': 'Repeated words (“the the”)',
  'double-space': 'Double spaces',
  'space-before-punct': 'Space before punctuation',
  'space-after-punct': 'Missing space after a comma',
  'space-after-sentence': 'Missing space between sentences',
  'sentence-capital': 'Capital letter at the start of a sentence',
  'lowercase-i': 'Lowercase “i”',
  'first-capital': 'Capital letter at the start of a paragraph',
  'a-an-vowel': '“a” before a vowel sound',
  'an-a-consonant': '“an” before a consonant sound',
  'common-misspelling': 'Common misspellings',
  'stronger-word': 'Stronger word for verb + adverb or “very” + adjective',
  'dialogue-redundant-tag': 'Redundant speech tags (“whispered quietly”)',
  'dialogue-period-before-tag': 'Period before a speech tag',
  'dialogue-tag-capital': 'Capitalised speech tag',
  'dialogue-missing-comma': 'Missing comma before a speech tag',
  'ellipsis-spacing': 'Ellipsis with too many dots',
  'multiple-punct': 'Repeated !! or ??',
  dialect: 'US/UK spelling differences',
  'name-consistency': 'Character and place name spelling',
  'repeated-sentence-start': 'Repeated sentence openings',
  'long-sentence': 'Very long sentences',
  adverb: 'Adverbs',
  'passive-voice': 'Passive voice',
  'filler-word': 'Filler words',
  cliche: 'Familiar phrases',
  spelling: 'Spelling (dictionary)',
  'new-name': 'Names not yet in your characters & world list',
  'character-fact': 'Character details missing from their entry (green)',
  'echo-word': 'Echo words (the same word again a few lines later)',
  'tense-shift': 'Tense slips (past and present mixed in narration)',
  continuity: 'Continuity: a character described differently elsewhere in the book',
  'continuity-death': 'Continuity: a character speaking after their death',
  'continuity-age': 'Continuity: ages that don’t fit the timeline',
  'character-conflict': 'Details that contradict a character’s entry (purple)',
  ...Object.fromEntries(CONFUSED.map(([id, , , , label]) => [id, label])),
};

/** Human-readable name for a check, for "turned-off checks" lists. */
export function ruleLabel(id: string): string {
  const n = normalizeRuleId(id);
  if (n.startsWith('lt:')) return `Online check: ${n.slice(3).replace(/_/g, ' ').toLowerCase()}`;
  return RULE_LABELS[n] ?? n;
}

/** Run all enabled deterministic rules over a string. Pure and synchronous. */
export function runRules(text: string, ctx: ProofreadContext): Suggestion[] {
  const out: Suggestion[] = [];
  for (const rule of RULES) {
    if (ctx.disabledRules.has(rule.id) || ctx.disabledCategories.has(rule.category)) continue;
    for (const hit of rule.run(text, ctx)) {
      if (rule.category !== 'style' && rule.category !== 'clarity' && ctx.dictionary.has(hit.original.toLowerCase())) continue;
      out.push({ ...hit, ruleId: rule.id, category: rule.category, severity: rule.severity, providerId: LOCAL_PROVIDER_ID });
    }
  }
  return dedupe(out);
}

/** Drop overlapping suggestions, preferring errors over warnings over style. */
export function dedupe(list: Suggestion[]): Suggestion[] {
  const rank = SEVERITY_RANK;
  const sorted = list.slice().sort((a, b) => rank[a.severity] - rank[b.severity] || a.start - b.start);
  const kept: Suggestion[] = [];
  for (const s of sorted) {
    const overlaps = kept.some((k) => s.start < k.end && k.start < s.end && !(k.severity === 'style' || s.severity === 'style'));
    if (!overlaps) kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Apply a replacement only if the text still matches what was checked. Returns null when stale. */
export function applySuggestion(text: string, s: Pick<Suggestion, 'start' | 'end' | 'original'>, replacement: string): string | null {
  if (s.start < 0 || s.end > text.length || s.start > s.end) return null;
  if (text.slice(s.start, s.end) !== s.original) return null;
  return text.slice(0, s.start) + replacement + text.slice(s.end);
}
