import { levenshtein } from '../domain/text';
import type { Category, ProofreadContext, Severity, Suggestion } from './types';

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
  return {
    id,
    category,
    severity,
    run(text) {
      const out: Hit[] = [];
      const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
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

const CONFUSED: [RegExp, string, string][] = [
  [/\b(could|would|should|must|might|may) of\b/i, '$1 have', '“of” is a mishearing of “have” here.'],
  [/\balot\b/i, 'a lot', '“A lot” is two words.'],
  [/\b(more|less|better|worse|rather|other|greater|fewer|bigger|smaller|faster|slower|older|younger|larger|higher|lower|taller|stronger|weaker) then\b/i, '$1 than', 'Use “than” for comparisons.'],
  [/\byour welcome\b/i, "you're welcome", 'Did you mean “you’re” (you are)?'],
  [/\bits (a|an|the|been|not|going|okay|ok|time|over|true|all|just|only|so|too|very|no)\b/i, "it's $1", 'Did you mean “it’s” (it is / it has)?'],
  [/\bit'?s own\b/i, 'its own', 'Possessive “its” has no apostrophe.'],
  [/\btheir (is|are|was|were)\b/i, 'there $1', 'Did you mean “there”?'],
  [/\bsuppose to\b/i, 'supposed to', 'Use “supposed to”.'],
  [/\b(to|will|would|could|might|not|don't|didn't|never) loose\b/i, '$1 lose', '“Loose” means not tight; “lose” means to misplace or be defeated.'],
  [/\b(to|could|couldn't|can't|cannot) breath\b/i, '$1 breathe', '“Breath” is the noun; the verb is “breathe”.'],
  [/\b(had|has|have) lead\b/i, '$1 led', 'The past participle of “lead” is “led”.'],
  [/\b(an|the) affect\b/i, '$1 effect', '“Effect” is usually the noun; “affect” is usually the verb.'],
  [/\bpeaked (my|his|her|their|your|our) (interest|curiosity)\b/i, 'piqued $1 $2', 'Interest is “piqued”.'],
  [/\bfor all intensive purposes\b/i, 'for all intents and purposes', 'The idiom is “for all intents and purposes”.'],
  [/\bshould of\b/i, 'should have', '“of” is a mishearing of “have” here.'],
  [/\bweather or not\b/i, 'whether or not', 'Use “whether” for alternatives.'],
  [/\b(?:per say)\b/i, 'per se', 'The Latin phrase is “per se”.'],
  [/\bfree reign\b/i, 'free rein', 'The idiom is “free rein”.'],
  [/\bsneak peak\b/i, 'sneak peek', 'A quick look is a “peek”.'],
  [/\bwould of\b/i, 'would have', '“of” is a mishearing of “have” here.'],
  [/\bthrough out\b/i, 'throughout', '“Throughout” is one word.'],
];

const MISSPELLINGS: Record<string, string> = {
  recieve: 'receive', recieved: 'received', seperate: 'separate', definately: 'definitely', occured: 'occurred',
  untill: 'until', wierd: 'weird', accomodate: 'accommodate', beleive: 'believe', goverment: 'government',
  tommorow: 'tomorrow', tomorow: 'tomorrow', truely: 'truly', arguement: 'argument', begining: 'beginning',
  calender: 'calendar', existance: 'existence', foriegn: 'foreign', happend: 'happened', independant: 'independent',
  neccessary: 'necessary', noticable: 'noticeable', occassion: 'occasion', persistant: 'persistent',
  posession: 'possession', publically: 'publicly', refered: 'referred', relevent: 'relevant', succesful: 'successful',
  suprise: 'surprise', thier: 'their', tounge: 'tongue', wich: 'which', writting: 'writing', acheive: 'achieve',
  teh: 'the', adn: 'and', becuase: 'because', freind: 'friend',
};

const US_UK: [string, string][] = [
  ['color', 'colour'], ['honor', 'honour'], ['favorite', 'favourite'], ['realize', 'realise'], ['center', 'centre'],
  ['theater', 'theatre'], ['traveled', 'travelled'], ['traveling', 'travelling'], ['defense', 'defence'],
  ['gray', 'grey'], ['armor', 'armour'], ['neighbor', 'neighbour'], ['behavior', 'behaviour'], ['harbor', 'harbour'],
  ['rumor', 'rumour'], ['labor', 'labour'], ['flavor', 'flavour'], ['valor', 'valour'], ['splendor', 'splendour'],
  ['organize', 'organise'], ['recognize', 'recognise'], ['apologize', 'apologise'], ['meter', 'metre'],
  ['plow', 'plough'], ['mold', 'mould'], ['jewelry', 'jewellery'],
  ['canceled', 'cancelled'], ['offense', 'offence'], ['skeptical', 'sceptical'], ['catalog', 'catalogue'],
];

const SAID_VERBS =
  'said|asked|whispered|replied|shouted|muttered|called|answered|cried|murmured|yelled|snapped|added|continued|explained|admitted|insisted|agreed|lied|sighed|laughed';

const ADVERB_EXCEPTIONS = new Set([
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

export const RULES: Rule[] = [
  regexRule('repeated-word', 'repetition', 'error', /\b([\p{L}']+)(\s+)\1\b/iu, (m) => `“${m[1]}” is repeated.`, (m) => {
    const w = m[1].toLowerCase();
    if (w === 'had' || w === 'that' || w === 'is' || w === 'bye' || w === 'no' || w === 'very' || w === 'knock') return null;
    return [m[1]];
  }),
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
  ...CONFUSED.map(([re, rep, msg], i) =>
    regexRule(`confused-${i}`, 'confused', 'warning', re, msg, (m) => [
      matchCase(m[0], m[0].replace(new RegExp(re.source, 'i'), rep)),
    ]),
  ),
  regexRule('a-an-vowel', 'grammar', 'warning', /\b(a) ([aeiou][\p{L}]*)/iu, 'Use “an” before a vowel sound.', (m) => {
    if (/^(one|once|uni|use|usu|usa|eu|ewe|ur|uti|ubiq|uk)/i.test(m[2])) return null;
    return [matchCase(m[1], 'an') + ' ' + m[2]];
  }),
  regexRule('an-a-consonant', 'grammar', 'warning', /\b(an) ([b-df-hj-np-tv-z][\p{L}]*)/iu, 'Use “a” before a consonant sound.', (m) => {
    if (/^(hour|honest|honou?r|heir|herb)/i.test(m[2])) return null;
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
      const re = /\b[\p{L}]+\b/gu;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const w = m[0].toLowerCase();
        for (const [us, uk] of US_UK) {
          if (us === uk) continue;
          const wrong = ctx.dialect === 'en-US' ? uk : us;
          const right = ctx.dialect === 'en-US' ? us : uk;
          if (w === wrong || w === wrong + 's' || w === wrong + 'ed' || w === wrong + 'ing') {
            const suffix = w.slice(wrong.length);
            out.push({
              start: m.index,
              end: m.index + m[0].length,
              original: m[0],
              replacements: [matchCase(m[0], right + suffix)],
              message: `“${m[0]}” is the ${ctx.dialect === 'en-US' ? 'UK' : 'US'} spelling; your dictionary is set to ${ctx.dialect === 'en-US' ? 'US' : 'UK'} English.`,
            });
          }
        }
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
      const names = new Map<string, string>();
      const lowercaseFlag = new Set<string>();
      for (const n of ctx.knownNames) {
        const parts = n.split(/\s+/).filter((p) => p.length >= 3 && !STOP_WORDS.has(p.toLowerCase()));
        for (const part of parts) names.set(part.toLowerCase(), part);
        // "elara" is worth flagging; "lamp" from "The Salt Lamp" is not.
        const tokens = n.split(/\s+/);
        if (tokens.length === 1 && tokens[0].length >= 3) lowercaseFlag.add(tokens[0].toLowerCase());
        else if (tokens[0] && !STOP_WORDS.has(tokens[0].toLowerCase()) && tokens[0].length >= 3) lowercaseFlag.add(tokens[0].toLowerCase());
      }
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
        for (const [k, v] of names) {
          if (Math.abs(k.length - lower.length) > 2 || k[0] !== lower[0]) continue;
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
  regexRule('adverb', 'style', 'style', /\b[\p{L}]{4,}ly\b/u, (m) => `“${m[0]}” is an adverb. A stronger verb may do the work.`, (m) =>
    ADVERB_EXCEPTIONS.has(m[0].toLowerCase()) ? null : [],
  ),
  regexRule('passive-voice', 'style', 'style', /\b(am|is|are|was|were|be|been|being)\s+([\p{L}]+ed|written|taken|given|seen|done|made|known|found|told|held|brought|thrown|driven|broken|chosen|forgotten|hidden|stolen)\b(?=\s+by\b)/u, 'Possible passive voice. Consider whether the actor should lead the sentence.', () => []),
  regexRule('filler-word', 'style', 'style', FILLER, (m) => `“${m[0]}” often adds little; consider cutting it.`, () => []),
  {
    id: 'cliche',
    category: 'style',
    severity: 'style',
    run(text) {
      const out: Hit[] = [];
      for (const c of CLICHES) {
        const re = new RegExp(`\\b${c}`, 'gi');
        let m: RegExpExecArray | null;
        while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, original: m[0], replacements: [], message: 'Familiar phrase. Is there a fresher way to say it?' });
      }
      return out;
    },
  },
];

export const RULE_IDS = RULES.map((r) => r.id);

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
  const rank: Record<Severity, number> = { error: 0, warning: 1, style: 2 };
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
