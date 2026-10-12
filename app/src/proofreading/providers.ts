import { dedupe, runRules, LOCAL_PROVIDER_ID } from './rules';
import type { ProofreadContext, ProofreadingProvider, Suggestion } from './types';
import type { SpellHit, SpellRequest, SpellResponse } from './spell.worker';

export const SPELL_PROVIDER_ID = 'local-spelling';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: SpellHit[][]) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    worker = new Worker(new URL('./spell.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<SpellResponse>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.error) p.reject(new Error(ev.data.error));
      else p.resolve(ev.data.results ?? []);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Spell checker failed to load'));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

/** Spell-check several blocks at once in the worker. */
export function spellCheckBlocks(texts: string[], ctx: ProofreadContext): Promise<Suggestion[][]> {
  const w = getWorker();
  if (!w || ctx.disabledCategories.has('spelling') || ctx.disabledRules.has('spelling')) {
    return Promise.resolve(texts.map(() => []));
  }
  const id = ++seq;
  const ignore = [...ctx.dictionary];
  for (const n of ctx.knownNames) ignore.push(...n.split(/\s+/));
  const req: SpellRequest = { id, dialect: ctx.dialect, texts, ignore };
  return new Promise<SpellHit[][]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage(req);
  }).then((results) =>
    results.map((hits) =>
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
  );
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
      spelling = (await spellCheckBlocks([text], ctx))[0] ?? [];
    } catch {
      spelling = [];
    }
    return dedupe([...rules, ...spelling]);
  },
};

/**
 * Batch check used by the editor: rules run inline (fast), spelling runs in the worker.
 * Returns suggestions per block text.
 */
export async function checkBlocks(
  texts: string[],
  ctx: ProofreadContext,
): Promise<{ results: Suggestion[][]; spellingError: string | null }> {
  const rules = texts.map((t) => runRules(t, ctx));
  let spelling: Suggestion[][] = texts.map(() => []);
  let spellingError: string | null = null;
  try {
    spelling = await spellCheckBlocks(texts, ctx);
  } catch (e) {
    spellingError = e instanceof Error ? e.message : String(e);
  }
  return { results: texts.map((_, i) => dedupe([...rules[i], ...(spelling[i] ?? [])])), spellingError };
}

/**
 * Placeholder for an optional remote grammar service. It is intentionally not wired to any vendor:
 * a remote provider must be explicitly enabled by the author, must call a server that holds the API key,
 * and must never run while the app is offline or the privacy toggle is off.
 */
export interface RemoteProviderConfig {
  endpoint: string;
  enabled: boolean;
}
