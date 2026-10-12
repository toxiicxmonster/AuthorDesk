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
const suggestCache = new Map<string, string[]>();

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
  error?: string;
}

const WORD = /[\p{L}][\p{L}'’]*[\p{L}]|[\p{L}]/gu;

self.onmessage = async (ev: MessageEvent<SpellRequest>) => {
  const { id, dialect, texts, ignore } = ev.data;
  try {
    const sp = await loadSpeller(dialect);
    const ignored = new Set(ignore.map((w) => w.toLowerCase()));
    const verdict = new Map<string, boolean>();
    const results = texts.map((text) => {
      const hits: SpellHit[] = [];
      let m: RegExpExecArray | null;
      WORD.lastIndex = 0;
      while ((m = WORD.exec(text))) {
        let word = m[0];
        const start = m.index;
        // Strip possessive / leading apostrophes that Hunspell does not model.
        const possessive = word.match(/^(.*?)['’]s$/);
        const check = (possessive ? possessive[1] : word).replace(/’/g, "'");
        if (check.length < 2 || ignored.has(check.toLowerCase())) continue;
        if (/^[A-Z]{2,}$/.test(check)) continue; // acronyms
        let ok = verdict.get(check);
        if (ok === undefined) {
          ok = sp.correct(check) || sp.correct(check.toLowerCase());
          verdict.set(check, ok);
        }
        if (ok) continue;
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
    (self as unknown as Worker).postMessage({ id, results } satisfies SpellResponse);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: e instanceof Error ? e.message : String(e) } satisfies SpellResponse);
  }
};
