import { dedupe, runRules, LOCAL_PROVIDER_ID } from './rules';
import type { ProofreadContext, ProofreadingProvider, Suggestion } from './types';
import type { SpellHit, SpellRequest, SpellResponse } from './spell.worker';
import { nameCandidates, newNameSuggestions, type WordKind } from './names';

export const SPELL_PROVIDER_ID = 'local-spelling';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: SpellResponse) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    worker = new Worker(new URL('./spell.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<SpellResponse>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.error) p.reject(new Error(ev.data.error));
      else p.resolve(ev.data);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Spell checker failed to load'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

/**
 * Spell-check several blocks at once in the worker. `lookup` words are also checked against the dictionary
 * (used to tell a real word like "Hidden" from a misspelled name like "Haldenn").
 */
export async function spellCheckBlocks(
  texts: string[],
  ctx: ProofreadContext,
  lookup: string[] = [],
): Promise<{ results: Suggestion[][]; known: boolean[] }> {
  const w = getWorker();
  const spellingOff = ctx.disabledCategories.has('spelling') || ctx.disabledRules.has('spelling');
  if (!w || (spellingOff && !lookup.length)) return { results: texts.map(() => []), known: lookup.map(() => false) };
  const id = ++seq;
  const ignore = [...ctx.dictionary];
  for (const n of ctx.knownNames) ignore.push(...n.split(/\s+/));
  const req: SpellRequest = { id, dialect: ctx.dialect, texts: spellingOff ? [] : texts, ignore, lookup };
  const res = await new Promise<SpellResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage(req);
  });
  const hitsPerText: SpellHit[][] = spellingOff ? texts.map(() => []) : (res.results ?? []);
  return {
    known: res.known ?? lookup.map(() => false),
    results: hitsPerText.map((hits) =>
      hits.map<Suggestion>((h) => ({
        start: h.start,
        end: h.end,
        original: h.word,
        replacements: h.suggestions,
        category: 'spelling',
        severity: 'error',
        message: h.suggestions.length ? `“${h.word}” may be misspelled.` : `“${h.word}” is not in the dictionary.`,
        ruleId: 'spelling',
        providerId: SPELL_PROVIDER_ID,
      })),
    ),
  };
}

/** Deterministic, fully local rules + bundled Hunspell dictionary. Nothing leaves the device. */
export const localProvider: ProofreadingProvider = {
  id: LOCAL_PROVIDER_ID,
  label: 'On-device checks',
  local: true,
  async check(text: string, ctx: ProofreadContext) {
    const rules = runRules(text, ctx);
    let spelling: Suggestion[];
    try {
      spelling = (await spellCheckBlocks([text], ctx)).results[0] ?? [];
    } catch {
      spelling = [];
    }
    return dedupe([...rules, ...spelling]);
  },
};

/** A fuzzy "did you mean <character name>?" hit, as opposed to a lowercase-name hit ("elara" → "Elara"). */
function isFuzzyNameHit(s: Suggestion): boolean {
  return s.ruleId === 'name-consistency' && s.replacements[0]?.toLowerCase() !== s.original.toLowerCase();
}

/**
 * Combine rule and dictionary results for one block:
 * - a rule's spelling hit (common misspelling, US/UK) explains more than the dictionary's, so it wins on the same word;
 * - "possible misspelling of <name>" is dropped when the word is a real dictionary word ("Hidden" vs "Halden").
 */
function combine(rules: Suggestion[], spelling: Suggestion[], knownWords: ReadonlySet<string>): Suggestion[] {
  const ruleSpelling = rules.filter((r) => r.category === 'spelling');
  const spell = spelling.filter((s) => !ruleSpelling.some((r) => s.start < r.end && r.start < s.end));
  const kept = rules.filter((r) => !(isFuzzyNameHit(r) && knownWords.has(r.original)));
  return dedupe([...kept, ...spell]);
}

// Per-block results for unchanged paragraphs, keyed by settings + exact text. Spelling failures are never cached.
const blockCache = new Map<string, Suggestion[]>();
const BLOCK_CACHE_LIMIT = 5_000;

function contextKey(ctx: ProofreadContext): string {
  return [
    ctx.dialect,
    [...ctx.disabledRules].sort().join(','),
    [...ctx.disabledCategories].sort().join(','),
    [...ctx.dictionary].sort().join(','),
    ctx.knownNames.join('|'),
  ].join('\u0002');
}

/**
 * Batch check used by the editor: rules run inline (fast), spelling runs in the worker.
 * Paragraphs that haven't changed since the last check come from a cache. Returns suggestions per block text.
 */
export async function checkBlocks(
  texts: string[],
  ctx: ProofreadContext,
): Promise<{ results: Suggestion[][]; spellingError: string | null }> {
  const ck = contextKey(ctx);
  const results: (Suggestion[] | null)[] = texts.map((t) => blockCache.get(ck + '\u0001' + t) ?? null);
  const todo = texts.map((_, i) => i).filter((i) => !results[i]);
  if (!todo.length) return { results: results as Suggestion[][], spellingError: null };

  const rules = todo.map((i) => runRules(texts[i], ctx));
  const lookup = [...new Set(rules.flat().filter(isFuzzyNameHit).map((s) => s.original))];
  let spelling: Suggestion[][] = todo.map(() => []);
  let known = new Set<string>();
  let spellingError: string | null = null;
  try {
    const r = await spellCheckBlocks(
      todo.map((i) => texts[i]),
      ctx,
      lookup,
    );
    spelling = r.results;
    known = new Set(lookup.filter((_, k) => r.known[k]));
  } catch (e) {
    spellingError = e instanceof Error ? e.message : String(e);
  }
  todo.forEach((i, k) => {
    const list = combine(rules[k], spelling[k] ?? [], known);
    results[i] = list;
    if (!spellingError) {
      const key = ck + '\u0001' + texts[i];
      blockCache.delete(key);
      blockCache.set(key, list);
      if (blockCache.size > BLOCK_CACHE_LIMIT) blockCache.delete(blockCache.keys().next().value as string);
    }
  });
  return { results: results as Suggestion[][], spellingError };
}

/**
 * People (and places) written in the scene that aren't in the reference library yet, as "add this name?" prompts.
 * Hunspell tells an ordinary word (Rose) from a dictionary proper noun (Sarah) from an invented name (Thorne).
 */
export async function findNewNames(texts: string[], ctx: ProofreadContext): Promise<Suggestion[][]> {
  const none = () => texts.map((): Suggestion[] => []);
  if (ctx.disabledRules.has('new-name') || ctx.disabledCategories.has('consistency')) return none();
  const candidates = nameCandidates(texts, ctx);
  if (!candidates.length) return none();
  const words = [...new Set(candidates.map((c) => c.word))];
  // Check the words themselves (for typo fixes) with spelling on, and look up each word and its lowercase form.
  const spellCtx: ProofreadContext = { ...ctx, disabledRules: new Set(), disabledCategories: new Set(), knownNames: [] };
  const r = await spellCheckBlocks(words, spellCtx, words.flatMap((w) => [w, w.toLowerCase()]));
  const index = new Map(words.map((w, i) => [w, i]));
  const kindOf = (w: string): WordKind => {
    const i = index.get(w)!;
    if (r.known[2 * i + 1]) return 'common';
    return r.known[2 * i] ? 'proper' : 'unknown';
  };
  const fixes = (w: string) => r.results[index.get(w)!]?.[0]?.replacements ?? [];
  return newNameSuggestions(texts, candidates, kindOf, fixes);
}

// The optional online provider (LanguageTool) lives in ./languageTool.ts. It is off by default, needs no API key,
// never runs offline, and is merged with these results by the editor's proofreading runner.
