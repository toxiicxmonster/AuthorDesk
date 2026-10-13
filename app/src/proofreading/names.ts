import type { ProofreadContext, Suggestion } from './types';

/**
 * Names in the manuscript: protecting the ones in the reference library from every check, and spotting people
 * who aren't in it yet so the author can add them. Pure; the dictionary lookups happen in providers.ts.
 */

/** Words never treated as part of a name on their own ("The Salt Road" protects "Salt" and "Road", not "The"). */
const NAME_STOP_WORDS = new Set(['the', 'of', 'a', 'an', 'and', 'in', 'on', 'at', 'to', 'for', 'de', 'la', 'le', 'von', 'van', 'du']);

const nameRegexCache = new WeakMap<readonly string[], RegExp | null>();

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One regex matching every known name, its parts and possessives, case-insensitively; cached per names list. */
function nameRegex(knownNames: readonly string[]): RegExp | null {
  if (nameRegexCache.has(knownNames)) return nameRegexCache.get(knownNames)!;
  const terms = new Set<string>();
  for (const n of knownNames) {
    const full = n.trim();
    if (full.length >= 2) terms.add(full.toLowerCase());
    for (const part of full.split(/\s+/)) if (part.length >= 2 && !NAME_STOP_WORDS.has(part.toLowerCase())) terms.add(part.toLowerCase());
  }
  const alts = [...terms].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = alts.length ? new RegExp(`(?<![\\p{L}\\p{N}'’-])(?:${alts.join('|')})(?![\\p{L}\\p{N}-])`, 'giu') : null;
  nameRegexCache.set(knownNames, re);
  return re;
}

/** [start, end) of every known name (or name part) in the text. */
export function knownNameSpans(text: string, knownNames: readonly string[]): [number, number][] {
  const re = nameRegex(knownNames);
  if (!re) return [];
  const out: [number, number][] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}

/** Rules that exist to help with names themselves, so they may touch them. */
const NAME_RULES = new Set(['name-consistency', 'new-name']);

/**
 * Drop every suggestion that would change a name. A suggestion that merely touches a name is kept only if each of
 * its fixes keeps the name as written ("a Elara" → "an Elara" is fine; "Elara" → "Clara" is not).
 */
export function protectNames(text: string, list: Suggestion[], spans: readonly [number, number][]): Suggestion[] {
  if (!spans.length) return list;
  return list.filter((s) => {
    if (NAME_RULES.has(s.ruleId)) return true;
    const hit = spans.filter(([a, b]) => s.start < b && a < s.end);
    if (!hit.length) return true;
    if (!s.replacements.length) return false;
    return hit.every(([a, b]) => a >= s.start && b <= s.end && s.replacements.every((r) => r.includes(text.slice(a, b))));
  });
}

// ---------- Spotting names that aren't in the reference library ----------

const SPEECH_AND_ACTION =
  'said|asked|replied|answered|whispered|murmured|muttered|shouted|yelled|called|cried|snapped|added|continued|explained|admitted|insisted|agreed|lied|sighed|laughed|' +
  'nodded|smiled|grinned|frowned|shrugged|looked|glanced|stared|turned|walked|ran|stood|sat|leaned|reached|stepped|paused|hesitated|swallowed|blinked|winced|' +
  'gasped|groaned|chuckled|smirked|scowled|wondered|thought|knew|felt|wanted|tried|took|pulled|pushed|grabbed|held|opened|closed|watched|waited|came|went|was|had|would|could';
const SIGNAL_AFTER = new RegExp(`^(?:['’]s\\b|\\s+(?:${SPEECH_AND_ACTION})\\b)`, 'i');
/** Titles and family words before a name ("Captain Ardent", "her grandma Betty"); abbreviations must be capitalized. */
const TITLES =
  /(?:\b(?:Mr|Mrs|Ms|Mx|Dr|Prof|St)\.?|\b(?:[Mm]iss|[Ll]ady|[Ll]ord|[Ss]ir|[Dd]ame|[Kk]ing|[Qq]ueen|[Pp]rince|[Pp]rincess|[Dd]uke|[Dd]uchess|[Cc]aptain|[Uu]ncle|[Aa]unt|[Aa]untie|[Pp]rofessor|[Dd]etective|[Oo]fficer|[Ss]ergeant|[Ii]nspector|[Dd]octor|[Ff]ather|[Mm]other|[Ss]ister|[Bb]rother|[Cc]ousin|[Gg]eneral|[Cc]ommander|[Mm]aster|[Mm]istress|[Mm]adam|[Mm]adame|[Gg]randma|[Gg]randpa|[Gg]randmother|[Gg]randfather|[Gg]ranny|[Nn]ana|[Ss]aint|[Mm]om|[Mm]um|[Dd]ad|[Hh]usband|[Ww]ife|[Ss]on|[Dd]aughter|[Nn]iece|[Nn]ephew|[Ff]riend|[Nn]eighbou?r))\s+$/;

/** Capitalized words that are never people's names on their own. */
const NOT_NAMES = new Set(
  (
    'i,i’m,i’d,i’ll,i’ve,he,she,it,we,you,they,his,her,its,our,your,their,him,them,us,me,my,this,that,these,those,there,here,then,when,what,who,why,how,god,gods,mr,mrs,ms,mx,dr,prof,sir,lady,lord,king,queen,prince,princess,captain,uncle,aunt,mom,mum,dad,ma,pa,grandma,grandpa,' +
    'monday,tuesday,wednesday,thursday,friday,saturday,sunday,january,february,march,april,may,june,july,august,september,october,november,december,' +
    'christmas,easter,halloween,english,french,spanish,german,american,british,european,african,asian,christian,jewish,muslim,catholic,ok,okay,tv,ai'
  ).split(','),
);

/** What precedes a sentence's (or a quotation's) first word. */
const SENTENCE_START = /(?:^|[.!?…]["”’)\]]*\s+|(?:^|\s)["“‘([]+|\n)$/;

export interface NameCandidate {
  block: number;
  start: number;
  end: number;
  word: string;
  /** First word of a sentence (or of a quotation), where capitals prove nothing. */
  initial: boolean;
  /** Followed by a speech/action verb or a possessive, or preceded by a title: behaves like a person. */
  signal: boolean;
  /** Already a listed name or part of one, e.g. the shared surname in “Betty Hartley”. */
  known: boolean;
  /** Capitalized words written side by side ("Betty Hartley") share a run. */
  run: number;
}

/**
 * Every capitalized word that might belong to an unlisted name, with the context that makes it likely.
 * Words of a listed name are included (marked known) only when they sit next to unlisted ones, so a full name
 * like "Betty Hartley" is seen whole even when "Hartley" is already known from "Winnie Hartley".
 */
export function nameCandidates(texts: readonly string[], ctx: Pick<ProofreadContext, 'dictionary' | 'knownNames'>): NameCandidate[] {
  const out: NameCandidate[] = [];
  const re = /(?<![\p{L}\p{N}'’-])(\p{Lu}\p{Ll}+(?:['’-]\p{Lu}\p{Ll}+)?)(?![\p{L}\p{N}-])/gu;
  let run = 0;
  texts.forEach((text, block) => {
    const known = knownNameSpans(text, ctx.knownNames);
    let prev: NameCandidate | null = null;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const word = m[1];
      const lower = word.toLowerCase();
      if (word.length < 2 || NOT_NAMES.has(lower) || NAME_STOP_WORDS.has(lower) || ctx.dictionary.has(lower)) {
        prev = null;
        continue;
      }
      const start = m.index;
      const end = start + word.length;
      const before = text.slice(Math.max(0, start - 30), start);
      const after = text.slice(end, end + 30);
      const adjacent = prev !== null && text.slice(prev.end, start) === ' ';
      const c: NameCandidate = {
        block,
        start,
        end,
        word,
        initial: SENTENCE_START.test(before),
        signal: SIGNAL_AFTER.test(after) || TITLES.test(before),
        known: known.some(([a, b]) => start < b && a < end),
        run: adjacent ? prev!.run : ++run,
      };
      out.push(c);
      prev = c;
    }
  });
  // A listed name on its own, or a run made only of listed names, needs nothing.
  const unlistedRuns = new Set(out.filter((c) => !c.known).map((c) => c.run));
  return out.filter((c) => unlistedRuns.has(c.run));
}

/** How the dictionary knows a word: 'common' (a lowercase word, e.g. Rose), 'proper' (only capitalized, e.g. Sarah), or 'unknown'. */
export type WordKind = 'common' | 'proper' | 'unknown';

function prompt(start: number, end: number, name: string, fixes: string[]): Suggestion {
  return {
    start,
    end,
    original: name,
    replacements: fixes,
    category: 'consistency',
    severity: 'warning',
    message: `“${name}” looks like a name that isn’t in your characters & world list yet. Add it so it’s never flagged again${fixes.length ? ', or pick a spelling below if it’s a typo' : ''}.`,
    ruleId: 'new-name',
    providerId: 'local-names',
  };
}

/**
 * Decide which candidates are probably unlisted names, and return one prompt per occurrence.
 * Full names ("Betty Hartley"): two or more capitalized words side by side, none an ordinary word (or one of them a
 * listed name, as relatives share a surname), are always a name. Single words:
 * - unknown to the dictionary (Thorne): a name if ever capitalized mid-sentence, acting like a person, or used twice;
 *   once at a sentence start with no other clue it stays a possible typo for the spelling check;
 * - a dictionary proper noun (Sarah, London): when it acts like a person, or appears twice;
 * - an ordinary word (Rose, Will, Hope): only mid-sentence and acting like a person ("then Rose said").
 */
export function newNameSuggestions(
  texts: readonly string[],
  candidates: readonly NameCandidate[],
  kindOf: (word: string) => WordKind,
  spellingFixes: (word: string) => string[] = () => [],
): Suggestion[][] {
  const results: Suggestion[][] = texts.map(() => []);
  const runs = new Map<number, NameCandidate[]>();
  for (const c of candidates) runs.set(c.run, [...(runs.get(c.run) ?? []), c]);

  const singles: NameCandidate[] = [];
  for (const run of runs.values()) {
    const toks = run.slice();
    // "Then Betty Hartley…": a sentence-opening ordinary word isn't part of the name.
    while (toks.length && !toks[0].known && toks[0].initial && kindOf(toks[0].word) === 'common') toks.shift();
    if (toks.length >= 2 && toks.some((t) => !t.known)) {
      const hasKnown = toks.some((t) => t.known);
      const ordinary = toks.some((t) => !t.known && kindOf(t.word) === 'common');
      if (hasKnown || !ordinary) {
        const first = toks[0];
        const last = toks[toks.length - 1];
        results[first.block].push(prompt(first.start, last.end, texts[first.block].slice(first.start, last.end), []));
        continue;
      }
    }
    for (const t of toks) if (!t.known) singles.push(t);
  }

  const byWord = new Map<string, NameCandidate[]>();
  for (const c of singles) byWord.set(c.word, [...(byWord.get(c.word) ?? []), c]);
  for (const [word, occ] of byWord) {
    const kind = kindOf(word);
    const midSentence = occ.some((c) => !c.initial);
    const acts = occ.some((c) => c.signal);
    const isName =
      kind === 'unknown' ? midSentence || acts || occ.length >= 2 : kind === 'proper' ? acts || occ.length >= 2 : occ.some((c) => !c.initial && c.signal);
    if (!isName) continue;
    const fixes = kind === 'unknown' ? spellingFixes(word).filter((f) => f !== word) : [];
    for (const c of occ) results[c.block].push(prompt(c.start, c.end, word, fixes));
  }
  for (const list of results) list.sort((a, b) => a.start - b.start);
  return results;
}
