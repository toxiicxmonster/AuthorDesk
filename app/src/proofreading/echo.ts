import { GLUE } from './wordLists';

/**
 * Echo words: the same noticeable word used again within a short distance ("She glanced at the door… He glanced
 * back"). Readers hear the repeat even when they don't notice it consciously. Pure.
 */

/** How close (in words) a repeat counts as an echo. */
export const ECHO_WINDOW = 50;

/** Words that repeat naturally in fiction and aren't worth flagging. */
const NATURAL = new Set(['said', 'says', 'asked', 'replied', 'thought', 'know', 'knew', 'want', 'wanted', 'back', 'looked', 'look', 'eyes', 'hand', 'hands', 'head', 'door', 'room', 'time', 'little', 'right', 'left', 'first', 'last', 'yeah', 'okay']);

/** Words that name a person, like a name does ("Grandma", "my mom", "the nurse"): a different word would change who's meant. */
const PEOPLE = new Set(
  (
    'grandma,grandpa,granny,grandmother,grandfather,nana,nanna,gran,mawmaw,pawpaw,mom,mommy,mum,mummy,mama,momma,mother,dad,daddy,papa,father,' +
    'sister,brother,aunt,auntie,uncle,cousin,niece,nephew,husband,wife,son,daughter,baby,fiance,fiancé,fiancee,fiancée,' +
    'doctor,nurse,captain,sergeant,officer,detective,professor,coach,boss,king,queen,prince,princess,lord,lady,sir,ma’am,ma\'am,miss,mister'
  ).split(','),
);

/** Everyday places and parts of a setting ("the elevator", "the lobby"): like names, a different word would change where. */
const PLACES = new Set(
  (
    'house,home,bedroom,bathroom,living,hallway,hall,corridor,lobby,reception,elevator,lift,stairs,staircase,stairwell,porch,garage,' +
    'basement,attic,cellar,office,classroom,apartment,flat,building,hospital,clinic,school,church,store,shop,bookshop,bookstore,cafe,café,' +
    'diner,restaurant,kitchen,library,park,street,road,avenue,highway,sidewalk,parking,town,city,village,farm,barn,yard,backyard,garden,' +
    'forest,woods,beach,river,lake,ocean,shore,harbour,harbor,dock,pier,port,field,station,airport,hotel,motel,bridge,alley,square,market,mall,gym,stadium,courthouse,prison,jail'
  ).split(','),
);

export interface EchoHit {
  block: number;
  start: number;
  end: number;
  word: string;
  /** Words since the previous use. */
  distance: number;
}

const WORD = /[\p{L}][\p{L}'’-]*/gu;
const base = (w: string) => w.toLowerCase().replace(/['’]s$/, '');

/**
 * Names of people and places written in the text but not (yet) in the references: words capitalised mid-sentence
 * ("they rode to Ashford") and never written in lower case.
 */
function namesInText(texts: readonly string[]): Set<string> {
  const capitalised = new Set<string>();
  const lower = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(WORD)) {
      const w = base(m[0]);
      if (m[0][0] !== m[0][0].toUpperCase()) lower.add(w);
      else if (m[0][0] !== m[0][0].toLowerCase() && !/(^|[.!?…:]["”’']?\s*|["“]\s*)$/.test(text.slice(Math.max(0, m.index - 4), m.index)))
        capitalised.add(w);
    }
  }
  return new Set([...capitalised].filter((w) => !lower.has(w)));
}

/**
 * Every echo across the paragraphs (in order), marking the second use. Repeats inside quoted speech are left alone,
 * and so are names of people and places: those in the references (`names`, with aliases) and ones found in the text.
 */
export function findEchoes(texts: readonly string[], names: readonly string[] = [], window = ECHO_WINDOW): EchoHit[] {
  const nameParts = new Set([...names.flatMap((n) => n.toLowerCase().split(/[\s-]+/).map(base)), ...namesInText(texts)]);
  const lastSeen = new Map<string, number>();
  const out: EchoHit[] = [];
  let index = 0;
  texts.forEach((text, block) => {
    let inQuote = false;
    let pos = 0;
    WORD.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD.exec(text))) {
      // Track whether we're inside quoted speech, from the quote marks since the last word.
      for (const ch of text.slice(pos, m.index)) {
        if (ch === '“') inQuote = true;
        else if (ch === '”') inQuote = false;
        else if (ch === '"') inQuote = !inQuote;
      }
      pos = m.index + m[0].length;
      const w = base(m[0]);
      index++;
      if (w.length < 4 || GLUE.has(w) || NATURAL.has(w) || PEOPLE.has(w) || PLACES.has(w) || PLACES.has(w.replace(/s$/, '')) || nameParts.has(w) || /['’](t|ll|ve|re|d|m)$/.test(w)) continue;
      const prev = lastSeen.get(w);
      lastSeen.set(w, index);
      if (prev === undefined || inQuote) continue;
      const distance = index - prev;
      if (distance > 1 && distance <= window) out.push({ block, start: m.index, end: m.index + m[0].length, word: m[0], distance });
    }
  });
  return out;
}

/** A rough word stem, so "glanced", "glance" and "glancing" count as the same word. */
export function stem(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’']s$/, '')
    .replace(/(ing|ed|es|s|ly)$/, '')
    .replace(/e$/, '');
}

/** The noticeable words in a passage (4+ letters, not glue words like "over" or "with"), lower-cased. */
export function noticeable(text: string): string[] {
  return (text.match(/[\p{L}’']{4,}/gu) ?? []).map((w) => w.toLowerCase()).filter((w) => !GLUE.has(w));
}

/**
 * Drops alternatives that would just make another echo: another form of the word itself ("stole a glance" for
 * "glanced"), or a word already used in the passage around it.
 */
export function avoidEchoes(word: string, list: readonly string[], nearby = ''): string[] {
  const used = new Set(noticeable(nearby).map(stem));
  used.add(stem(word));
  return list.filter((alt) => !noticeable(alt).some((w) => used.has(stem(w))));
}
