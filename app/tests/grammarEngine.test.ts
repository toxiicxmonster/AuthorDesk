import { resetDbForTests } from '../src/storage/db';
import { getSettings, updateSettings } from '../src/storage/settings';
import { adoptLocalEngine, fetchEngineStatus, isLocalEngine, localEngineEndpoint } from '../src/proofreading/grammarEngine';
import { checkOnline, resetOnlineCheckState, LT_PUBLIC_ENDPOINT } from '../src/proofreading/languageTool';

beforeEach(() => {
  resetDbForTests();
  resetOnlineCheckState();
});

const status = (s: object) =>
  (async () => new Response(JSON.stringify(s), { headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
const installed = status({ installed: true, ngrams: true, ready: true, starting: false });

describe('private grammar engine', () => {
  it('recognises only the launcher’s loopback engine address', () => {
    expect(isLocalEngine('http://localhost:47820/grammar/v2/check')).toBe(true);
    expect(isLocalEngine(localEngineEndpoint('http://127.0.0.1:47820'))).toBe(true);
    expect(isLocalEngine('https://example.com/grammar/v2/check')).toBe(false);
    expect(isLocalEngine(LT_PUBLIC_ENDPOINT)).toBe(false);
  });

  it('reads the launcher status, and is absent when not under the launcher', async () => {
    expect(await fetchEngineStatus(installed)).toEqual({ installed: true, ngrams: true, ready: true, starting: false });
    const html = (async () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } })) as unknown as typeof fetch;
    expect(await fetchEngineStatus(html)).toBeNull();
  });

  it('switches to the engine when installed, with picky style checks on', async () => {
    expect(await adoptLocalEngine(installed)).toBe(true);
    const oc = (await getSettings()).onlineCheck;
    expect(oc.enabled).toBe(true);
    expect(isLocalEngine(oc.endpoint)).toBe(true);
    expect(oc.picky).toBe(true);
  });

  it('replaces the public service, but respects an opt-out and the author’s own server', async () => {
    const base = (await getSettings()).onlineCheck;
    await updateSettings({ onlineCheck: { ...base, enabled: true, consentedAt: 'x', endpoint: LT_PUBLIC_ENDPOINT } });
    expect(await adoptLocalEngine(installed)).toBe(true);

    await updateSettings({ onlineCheck: { ...base, enabled: false, consentedAt: null, localEngineOptOut: true } });
    expect(await adoptLocalEngine(installed)).toBe(false);
    expect((await getSettings()).onlineCheck.enabled).toBe(false);

    await updateSettings({ onlineCheck: { ...base, enabled: true, consentedAt: 'x', endpoint: 'https://lt.example.org/v2/check', localEngineOptOut: false } });
    expect(await adoptLocalEngine(installed)).toBe(false);
    expect((await getSettings()).onlineCheck.endpoint).toBe('https://lt.example.org/v2/check');
  });

  it('does nothing when the engine isn’t installed', async () => {
    expect(await adoptLocalEngine(status({ installed: false }))).toBe(false);
    expect((await getSettings()).onlineCheck.enabled).toBe(false);
  });

  it('is never rate-limited and says plainly when it is still starting', async () => {
    const settings = { enabled: true, endpoint: localEngineEndpoint('http://localhost:47820'), picky: true, consentedAt: 'x', localEngineOptOut: false };
    const ctx = { dialect: 'en-US' as const, disabledRules: new Set<string>(), disabledCategories: new Set<string>(), dictionary: new Set<string>(), knownNames: [] };
    let calls = 0;
    const ok = (async () => {
      calls++;
      return new Response(JSON.stringify({ matches: [] }), { headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const big = Array.from({ length: 12 }, (_, i) => `${'word '.repeat(2300)}${i}`);
    const r = await checkOnline(big, ctx, settings, ok);
    expect(r.unchecked).toBe(0);
    expect(calls).toBe(12);

    resetOnlineCheckState();
    const starting = (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch;
    const r2 = await checkOnline(['He go home.'], ctx, settings, starting);
    expect(r2.error).toMatch(/still starting/);
  });
});
