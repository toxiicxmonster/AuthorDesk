import type { Category, ProofreadContext, Severity, Suggestion } from './types';
import { synonymsFor } from './synonyms';
import { LT_PUBLIC_ENDPOINT, type OnlineCheckSettings } from '../domain/schema';

export { LT_PUBLIC_ENDPOINT, type OnlineCheckSettings };

/**
 * Optional online grammar check using LanguageTool (https://languagetool.org).
 *
 * Privacy model:
 * - Off by default. The author turns it on after reading exactly what is sent (Settings → Proofreading).
 * - Only the paragraphs of the scene being checked are sent; never titles, notes, references or other scenes.
 * - Each paragraph is sent once: results are cached in memory by exact text, so only edited paragraphs are re-sent.
 * - Never runs offline. No API key: the free public service needs none, and keys must never live in the client.
 * - A self-hosted LanguageTool server (e.g. on this PC) can be used instead, so text never leaves the machine.
 */

export const LT_PROVIDER_ID = 'languagetool';

/** Free public API limits (per IP): 20 requests and 75 KB of text a minute, 20 KB per request. We stay under them. */
const PUBLIC_LIMITS = { requestsPerMinute: 18, charsPerMinute: 60_000 };
const MAX_REQUEST_CHARS = 12_000;
const TIMEOUT_MS = 20_000;
/** The engine on this computer can be slow on its first checks while it loads its n-gram data. */
const LOCAL_TIMEOUT_MS = 60_000;
const CACHE_LIMIT = 4_000;

/**
 * LanguageTool rules that misfire on fiction. EN_QUOTES (picky) flags every straight " as "use a curly quote",
 * even when correctly paired: a typesetting preference, not a mistake.
 */
const LT_DISABLED_RULES = ['EN_QUOTES'];

/** Where the AuthorDesk desktop app exposes the grammar engine running on this computer (see grammarEngine.ts). */
export const LOCAL_ENGINE_PATH = '/grammar/v2/check';

export function isLocalEngine(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.pathname === LOCAL_ENGINE_PATH && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export function isPublicEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname === 'api.languagetool.org';
  } catch {
    return false;
  }
}

/** Returns a problem description, or null when the address is acceptable. */
export function endpointProblem(endpoint: string): string | null {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return 'That is not a web address.';
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return 'Use an https:// address (http:// is only allowed for a server on this computer).';
  if (u.username || u.password) return 'Don’t put a user name or password in the address.';
  if (!/\/v2\/check\/?$/.test(u.pathname)) return 'The address should end in /v2/check.';
  return null;
}

interface LtMatch {
  message: string;
  shortMessage?: string;
  offset: number;
  length: number;
  replacements: { value: string }[];
  rule: { id: string; description?: string; issueType?: string; category?: { id?: string; name?: string } };
}

/** One LanguageTool finding inside a single paragraph, before the author's settings are applied. */
interface RawHit {
  start: number;
  end: number;
  message: string;
  replacements: string[];
  ruleId: string;
  categoryId: string;
  issueType: string;
}

const CATEGORY_MAP: Record<string, Category> = {
  TYPOS: 'spelling',
  COMPOUNDING: 'spelling',
  GRAMMAR: 'grammar',
  COLLOCATIONS: 'grammar',
  MISC: 'grammar',
  PUNCTUATION: 'punctuation',
  TYPOGRAPHY: 'punctuation',
  CASING: 'capitalization',
  CONFUSED_WORDS: 'confused',
  REPETITIONS: 'repetition',
  SEMANTICS: 'clarity',
  REDUNDANCY: 'style',
  REPETITIONS_STYLE: 'style',
  STYLE: 'style',
  PLAIN_ENGLISH: 'style',
  CREATIVE_WRITING: 'style',
  GENDER_NEUTRALITY: 'style',
};

function categoryOf(h: RawHit): Category {
  return CATEGORY_MAP[h.categoryId] ?? 'grammar';
}

function severityOf(h: RawHit, category: Category): Severity {
  if (category === 'style' || category === 'clarity') return 'style';
  return h.issueType === 'misspelling' ? 'error' : 'warning';
}

// --- cache & rate limit (module state; in memory only) ---

const cache = new Map<string, RawHit[]>();
const sent: { at: number; chars: number }[] = [];

function cacheKey(endpoint: string, dialect: string, picky: boolean, text: string) {
  return `${endpoint}\u0001${dialect}\u0001${picky ? 1 : 0}\u0001${text}`;
}

function remember(key: string, hits: RawHit[]) {
  cache.delete(key);
  cache.set(key, hits);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

function withinBudget(chars: number, now: number): boolean {
  while (sent.length && now - sent[0].at > 60_000) sent.shift();
  const used = sent.reduce((n, s) => n + s.chars, 0);
  return sent.length < PUBLIC_LIMITS.requestsPerMinute && used + chars <= PUBLIC_LIMITS.charsPerMinute;
}

/** For tests. */
export function resetOnlineCheckState() {
  cache.clear();
  sent.length = 0;
}

// --- conversion ---

function toSuggestions(text: string, hits: RawHit[], ctx: ProofreadContext): Suggestion[] {
  const names = new Set<string>();
  for (const n of ctx.knownNames) for (const part of n.split(/\s+/)) if (part) names.add(part.toLowerCase());
  const out: Suggestion[] = [];
  for (const h of hits) {
    const category = categoryOf(h);
    const ruleId = `lt:${h.ruleId}`;
    if (LT_DISABLED_RULES.includes(h.ruleId)) continue;
    if (ctx.disabledCategories.has(category) || ctx.disabledRules.has(ruleId)) continue;
    const original = text.slice(h.start, h.end);
    if (!original) continue;
    const lower = original.toLowerCase();
    // LanguageTool doesn't know the author's dictionary or invented names.
    if (category === 'spelling' && (ctx.dictionary.has(lower) || names.has(lower) || names.has(lower.replace(/['’]s$/, '')))) continue;
    // An online finding is only worth an underline if it says what to write instead. A repeated word without a
    // fix gets alternatives from the bundled thesaurus; anything else unfixable is left to the on-device checks.
    let replacements = h.replacements.filter((r) => r !== original);
    if (!replacements.length && (category === 'repetition' || h.categoryId === 'REPETITIONS_STYLE')) replacements = synonymsFor(original);
    if (!replacements.length) continue;
    out.push({
      start: h.start,
      end: h.end,
      original,
      replacements,
      category,
      severity: severityOf(h, category),
      message: h.message,
      ruleId,
      providerId: LT_PROVIDER_ID,
    });
  }
  return out;
}

export interface OnlineCheckResult {
  results: Suggestion[][];
  /** Paragraphs that could not be checked this time (rate limit, error, offline). */
  unchecked: number;
  /** A short, honest explanation when something didn't run; null when everything was checked. */
  error: string | null;
  /** How many requests were actually sent. */
  requests: number;
}

/**
 * Check paragraphs with LanguageTool. Paragraphs already checked (same text and settings) come from the cache;
 * the rest are sent in batches. Returns suggestions per paragraph, filtered by the author's settings.
 */
export async function checkOnline(
  texts: string[],
  ctx: ProofreadContext,
  settings: OnlineCheckSettings,
  fetchImpl?: typeof fetch,
  /** Only return what is already known (no network); used by the quick on-device pass while typing. */
  cacheOnly = false,
): Promise<OnlineCheckResult> {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const empty = (): Suggestion[][] => texts.map(() => []);
  const problem = endpointProblem(settings.endpoint);
  if (problem) return { results: empty(), unchecked: texts.length, error: `Online check address: ${problem}`, requests: 0 };

  const keys = texts.map((t) => cacheKey(settings.endpoint, ctx.dialect, settings.picky, t));
  const todo: number[] = [];
  texts.forEach((t, i) => {
    if (/\p{L}/u.test(t) && !cache.has(keys[i])) todo.push(i);
  });

  let error: string | null = null;
  let requests = 0;
  const failed = new Set<number>();

  if (cacheOnly) {
    todo.forEach((i) => failed.add(i));
  } else if (todo.length && !isLocalEngine(settings.endpoint) && typeof navigator !== 'undefined' && navigator.onLine === false) {
    error = 'You’re offline, so the online check is paused. On-device checks still run.';
    todo.forEach((i) => failed.add(i));
  } else {
    // Group paragraphs into requests; LanguageTool treats a blank line as a paragraph break.
    const batches: number[][] = [];
    let cur: number[] = [];
    let size = 0;
    for (const i of todo) {
      const len = texts[i].length + 2;
      if (texts[i].length > MAX_REQUEST_CHARS) {
        failed.add(i);
        error ??= 'A very long paragraph was skipped by the online check.';
        continue;
      }
      if (cur.length && size + len > MAX_REQUEST_CHARS) {
        batches.push(cur);
        cur = [];
        size = 0;
      }
      cur.push(i);
      size += len;
    }
    if (cur.length) batches.push(cur);

    const isPublic = isPublicEndpoint(settings.endpoint);
    const local = isLocalEngine(settings.endpoint);
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const joined = batch.map((i) => texts[i]).join('\n\n');
      if (isPublic && !withinBudget(joined.length, Date.now())) {
        for (const rest of batches.slice(b)) rest.forEach((i) => failed.add(i));
        error = 'The free LanguageTool service allows about 20 checks a minute. The rest of this scene will be checked on the next pass.';
        break;
      }
      const body = new URLSearchParams({ text: joined, language: ctx.dialect });
      if (settings.picky) body.set('level', 'picky');
      body.set('disabledRules', LT_DISABLED_RULES.join(','));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), local ? LOCAL_TIMEOUT_MS : TIMEOUT_MS);
      try {
        requests++;
        if (isPublic) sent.push({ at: Date.now(), chars: joined.length });
        const res = await doFetch(settings.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: body.toString(),
          signal: ctrl.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        if (!res.ok) {
          throw new Error(
            local && res.status === 503
              ? 'The grammar engine on this computer is still starting; it will check this scene in a moment.'
              : res.status === 429
              ? 'LanguageTool says too many checks were sent; it will try again shortly.'
              : res.status === 413
                ? 'That text is too long for the online check.'
                : `LanguageTool returned an error (HTTP ${res.status}).`,
          );
        }
        const data = (await res.json()) as { matches?: LtMatch[] };
        // Split matches back into their paragraphs.
        const starts: number[] = [];
        let pos = 0;
        for (const i of batch) {
          starts.push(pos);
          pos += texts[i].length + 2;
        }
        const per: RawHit[][] = batch.map(() => []);
        for (const m of data.matches ?? []) {
          if (typeof m.offset !== 'number' || typeof m.length !== 'number' || !m.rule?.id) continue;
          let k = starts.length - 1;
          while (k > 0 && starts[k] > m.offset) k--;
          const start = m.offset - starts[k];
          const end = start + m.length;
          if (start < 0 || end > texts[batch[k]].length || end <= start) continue; // crosses a paragraph break
          per[k].push({
            start,
            end,
            message: m.message || m.shortMessage || m.rule.description || 'Possible problem.',
            replacements: (m.replacements ?? []).slice(0, 5).map((r) => r.value).filter((v) => typeof v === 'string'),
            ruleId: m.rule.id,
            categoryId: m.rule.category?.id ?? '',
            issueType: m.rule.issueType ?? '',
          });
        }
        batch.forEach((i, k) => remember(keys[i], per[k]));
      } catch (e) {
        batch.forEach((i) => failed.add(i));
        error =
          e instanceof DOMException && e.name === 'AbortError'
            ? 'The online check took too long and was skipped.'
            : e instanceof TypeError
              ? local
                ? 'Couldn’t reach the grammar engine on this computer. Restart AuthorDesk; on-device checks still run.'
                : 'Couldn’t reach the online check. On-device checks still run.'
              : e instanceof Error
                ? e.message
                : String(e);
        // Don't keep hammering a failing service in the same pass.
        for (const rest of batches.slice(b + 1)) rest.forEach((i) => failed.add(i));
        break;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  const results = texts.map((t, i) => {
    const hits = cache.get(keys[i]);
    return hits ? toSuggestions(t, hits, ctx) : [];
  });
  return { results, unchecked: failed.size, error, requests };
}
