// @vitest-environment node
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { openStore } from '../../server/store.js';
import { createApp } from '../../server/index.js';

let base = '';
let close: () => void;

beforeAll(async () => {
  const appDir = mkdtempSync(join(tmpdir(), 'ad-app-'));
  writeFileSync(join(appDir, 'index.html'), '<html>app</html>');
  mkdirSync(join(appDir, 'assets'));
  writeFileSync(join(appDir, 'assets', 'a.js'), 'x');
  const store = openStore(':memory:');
  store.addUser('author', 'correct horse battery');
  const server = createApp(store, { appDir, secureCookies: false });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => {
    server.close();
    store.close();
  };
});
afterAll(() => close());

const H = { 'X-AuthorDesk': '1', 'Content-Type': 'application/json' };

describe('sync server HTTP', () => {
  it('serves the app and blocks path traversal', async () => {
    expect(await (await fetch(`${base}/`)).text()).toContain('app');
    expect((await fetch(`${base}/assets/a.js`)).headers.get('cache-control')).toContain('immutable');
    const t = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
    expect(await t.text()).not.toContain('root:');
  });

  it('reports status and requires sign-in for sync', async () => {
    const s = await (await fetch(`${base}/api/status`, { headers: H })).json();
    expect(s).toMatchObject({ server: 'authordesk-sync', signedIn: false });
    expect((await fetch(`${base}/api/sync/pull?since=0`, { headers: H })).status).toBe(401);
  });

  it('rejects POSTs without the anti-CSRF header', async () => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'author', password: 'correct horse battery' }) });
    expect(r.status).toBe(403);
  });

  it('logs in with an HttpOnly cookie and syncs', async () => {
    expect((await fetch(`${base}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ username: 'author', password: 'nope nope nope' }) })).status).toBe(401);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: H, body: JSON.stringify({ username: 'author', password: 'correct horse battery' }) });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    const cookie = setCookie.split(';')[0];
    const push = await fetch(`${base}/api/sync/push`, {
      method: 'POST',
      headers: { ...H, cookie },
      body: JSON.stringify({ changes: [{ record: { table: 'notes', id: 'n1', projectId: 'p', rev: 1, deleted: false, data: { id: 'n1' } }, baseVersion: null }] }),
    });
    expect((await push.json()).accepted).toHaveLength(1);
    const pull = await (await fetch(`${base}/api/sync/pull?since=0`, { headers: { ...H, cookie } })).json();
    expect(pull.records[0].id).toBe('n1');
    await fetch(`${base}/api/logout`, { method: 'POST', headers: { ...H, cookie }, body: '{}' });
    expect((await fetch(`${base}/api/sync/pull?since=0`, { headers: { ...H, cookie } })).status).toBe(401);
  });
});
