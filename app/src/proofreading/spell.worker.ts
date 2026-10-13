/// <reference lib="webworker" />
import nspell from 'nspell';
import usAff from '../../node_modules/dictionary-en/index.aff?url';
import usDic from '../../node_modules/dictionary-en/index.dic?url';
import gbAff from '../../node_modules/dictionary-en-gb/index.aff?url';
import gbDic from '../../node_modules/dictionary-en-gb/index.dic?url';

/**
 * Hunspell-compatible spell checking in a worker so large chapters never block the editor.
 * Text stays on the device; dictionaries are bundled with the app.
 */

type Speller = ReturnType<typeof nspell>;
const spellers = new Map<string, Promise<Speller>>();
/** Per dialect: word → correct? and word → suggestions. Kept across requests; cleared if they grow large. */
const verdicts = new Map<string, Map<string, boolean>>();
const suggestions = new Map<string, Map<string, string[]>>();
const CACHE_LIMIT = 50_000;

function cacheFor<T>(all: Map<string, Map<string, T>>, dialect: string): Map<string, T> {
  let c = all.get(dialect);
  if (!c || c.size > CACHE_LIMIT) {
    c = new Map();
    all.set(dialect, c);
  }
  return c;
}

function loadSpeller(dialect: string): Promise<Speller> {
  let p = spellers.get(dialect);
  if (!p) {
    const [aff, dic] = dialect === 'en-GB' ? [gbAff, gbDic] : [usAff, usDic];
    p = Promise.all([fetch(aff).then((r) => r.text()), fetch(dic).then((r) => r.text())]).then(([a, d]) => nspell(a, d));
    spellers.set(dialect, p);
  }
  return p;
}

export interface SpellRequest {
  id: number;
  dialect: string;
  texts: string[];
  ignore: string[];
  /** Words to look up: the response says whether each is a correct dictionary word. */
  lookup?: string[];
}

export interface SpellHit {
  start: number;
  end: number;
  word: string;
  suggestions: string[];
}

export interface SpellResponse {
  id: number;
  results?: SpellHit[][];
  known?: boolean[];
  error?: string;
}

const WORD = /[\p{L}][\p{L}'’]*[\p{L}]|[\p{L}]/gu;
/** Web and email addresses are not prose; don't spell-check inside them. */
const ADDRESS = /\b(?:https?:\/\/|www\.)\S+|\b[\w.+-]+@[\w-]+\.[\w.]+/gi;

function addressRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  ADDRESS.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ADDRESS.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}

self.onmessage = async (ev: MessageEvent<SpellRequest>) => {
  const { id, dialect, texts, ignore, lookup } = ev.data;
  try {
    const sp = await loadSpeller(dialect);
    const ignored = new Set(ignore.map((w) => w.toLowerCase()));
    const verdict = cacheFor(verdicts, dialect);
    const suggestCache = cacheFor(suggestions, dialect);
    const isCorrect = (w: string) => {
      let ok = verdict.get(w);
      if (ok === undefined) {
        ok = sp.correct(w) || sp.correct(w.toLowerCase());
        verdict.set(w, ok);
      }
      return ok;
    };
    const results = texts.map((text) => {
      const hits: SpellHit[] = [];
      const skip = addressRanges(text);
      let m: RegExpExecArray | null;
      WORD.lastIndex = 0;
      while ((m = WORD.exec(text))) {
        const at = m.index;
        if (skip.some(([a, b]) => at >= a && at < b)) continue;
        let word = m[0];
        const start = m.index;
        // Strip possessive / leading apostrophes that Hunspell does not model.
        const possessive = word.match(/^(.*?)['’]s$/);
        const check = (possessive ? possessive[1] : word).replace(/’/g, "'");
        if (check.length < 2 || ignored.has(check.toLowerCase())) continue;
        if (/^[A-Z]{2,}$/.test(check)) continue; // acronyms
        if (isCorrect(check)) continue;
        if (possessive) word = possessive[1];
        let sugg = suggestCache.get(check);
        if (!sugg) {
          sugg = sp.suggest(check).slice(0, 4);
          suggestCache.set(check, sugg);
        }
        hits.push({ start, end: start + word.length, word, suggestions: sugg });
      }
      return hits;
    });
    const known = lookup?.map((w) => isCorrect(w.replace(/’/g, "'")));
    (self as unknown as Worker).postMessage({ id, results, known } satisfies SpellResponse);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: e instanceof Error ? e.message : String(e) } satisfies SpellResponse);
  }
};
