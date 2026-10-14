import { chat, fetchAiStatus } from '../ai/aiEditor';
import type { AddonId, SetupStatus } from './addons';

/**
 * Add-on health checks: each engine does a small real job (the grammar engine checks a sentence with a known mistake;
 * the AI Editor answers a one-word question), with a plain-language result. Repair re-runs the installer in repair
 * mode, which checks the installed files and replaces only what's damaged.
 */

export interface HealthResult {
  ok: boolean;
  message: string;
}

const TEST_SENTENCE = 'She go to the shop yesterday.';

export async function checkGrammarEngine(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<HealthResult> {
  try {
    const st = await fetchImpl('/grammar/status', { cache: 'no-store' });
    const status = st.ok ? ((await st.json()) as { installed?: boolean; running?: boolean; ready?: boolean }) : null;
    if (!status?.installed) return { ok: false, message: 'Not installed. Use Install above.' };
    const t0 = performance.now();
    const res = await fetchImpl('/grammar/v2/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ text: TEST_SENTENCE, language: 'en-US' }).toString(),
    });
    if (!res.ok) return { ok: false, message: `It didn’t answer properly (error ${res.status}). It may still be starting: try again in a minute, or use Repair.` };
    const data = (await res.json()) as { matches?: unknown[] };
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    if (!Array.isArray(data.matches) || !data.matches.length) return { ok: false, message: 'It answered but missed a known mistake (“She go”). Use Repair.' };
    return { ok: true, message: `Working: caught a test mistake in ${secs} s.` };
  } catch {
    return { ok: false, message: 'Couldn’t reach it. Restart AuthorDesk; if it still fails, use Repair.' };
  }
}

export async function checkAiEditor(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<HealthResult> {
  const st = await fetchAiStatus(fetchImpl);
  if (!st) return { ok: false, message: 'Couldn’t reach AuthorDesk. Start AuthorDesk.exe.' };
  if (!st.installed) return { ok: false, message: 'Not installed. Use Install above.' };
  const t0 = performance.now();
  try {
    const answer = await chat([{ role: 'user', content: 'What is 2 + 3? Answer with the number only.' }], { fetchImpl, temperature: 0, maxTokens: 8 });
    const secs = Math.round((performance.now() - t0) / 1000);
    if (!/\b(?:5|five)\b/i.test(answer)) return { ok: false, message: `The model answered oddly (“${answer.trim().slice(0, 40)}”). Use Repair.` };
    return { ok: true, message: `Working: ${st.model ?? 'the model'} answered in ${secs} s${secs > 8 ? ' (including loading it)' : ''}.` };
  } catch (e) {
    return { ok: false, message: `${e instanceof Error ? e.message : 'It didn’t answer.'} If this keeps happening, use Repair.` };
  }
}

export const checkAddon = (id: AddonId) => (id === 'grammar' ? checkGrammarEngine() : checkAiEditor());

export async function repairAddon(id: AddonId, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<SetupStatus | null> {
  try {
    const res = await fetchImpl(`/setup/install?parts=${id}&repair=1`, { method: 'POST' });
    return res.ok ? ((await res.json()) as SetupStatus) : null;
  } catch {
    return null;
  }
}

export async function fetchAddonLogs(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<string> {
  try {
    const res = await fetchImpl('/setup/log', { cache: 'no-store' });
    return res.ok ? await res.text() : 'The log isn’t available.';
  } catch {
    return 'The log isn’t available (AuthorDesk isn’t running).';
  }
}
