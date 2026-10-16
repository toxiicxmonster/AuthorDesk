import { getSettings, updateSettings } from '../storage/settings';
import { LT_PUBLIC_ENDPOINT } from '../domain/schema';
import { LOCAL_ENGINE_PATH, isLocalEngine } from './languageTool';

export { isLocalEngine };

/**
 * The private grammar engine: LanguageTool (with English n-gram data) running on this computer, started by the
 * AuthorDesk desktop app and reached through it at /grammar/* (same origin, loopback only). Text never leaves the
 * machine, so unlike the public service it needs no consent dialog and has no rate limit.
 * Installed from Settings → Add-ons (desktop/src/installers.cjs).
 */

export interface EngineStatus {
  installed: boolean;
  /** English n-gram data present (catches confused words from real usage statistics). */
  ngrams: boolean;
  ready: boolean;
  starting: boolean;
}

export function localEngineEndpoint(origin = globalThis.location?.origin ?? 'http://localhost:47820'): string {
  return origin + LOCAL_ENGINE_PATH;
}

/** Asks the desktop app about the engine. Null when not running under the desktop app (e.g. the dev server). */
export async function fetchEngineStatus(fetchImpl: typeof fetch = globalThis.fetch?.bind(globalThis)): Promise<EngineStatus | null> {
  if (!fetchImpl) return null;
  try {
    const res = await fetchImpl('/grammar/status', { cache: 'no-store' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const j = (await res.json()) as Partial<EngineStatus>;
    return { installed: !!j.installed, ngrams: !!j.ngrams, ready: !!j.ready, starting: !!j.starting };
  } catch {
    return null;
  }
}

/** Point the grammar check at this computer's engine, with picky (style) rules on, Grammarly-style. */
export async function switchToLocalEngine() {
  const s = await getSettings();
  await updateSettings({
    onlineCheck: { ...s.onlineCheck, enabled: true, endpoint: localEngineEndpoint(), picky: true, consentedAt: new Date().toISOString(), localEngineOptOut: false },
  });
}

/**
 * On start: if the engine is installed, use it, unless the author turned it off or set up their own server.
 * Switching away from the public service is always a privacy gain, so it needs no confirmation.
 */
export async function adoptLocalEngine(fetchImpl?: typeof fetch): Promise<boolean> {
  const status = await fetchEngineStatus(fetchImpl);
  if (!status?.installed) return false;
  const { onlineCheck: oc } = await getSettings();
  if (oc.localEngineOptOut) return false;
  const on = oc.enabled && !!oc.consentedAt;
  if (on && isLocalEngine(oc.endpoint)) {
    // Same engine, but the app may be served from a different origin than when it was set; keep it pointing here.
    if (oc.endpoint !== localEngineEndpoint()) await updateSettings({ onlineCheck: { ...oc, endpoint: localEngineEndpoint() } });
    return true;
  }
  if (on && oc.endpoint !== LT_PUBLIC_ENDPOINT) return false; // the author's own server
  await switchToLocalEngine();
  return true;
}
