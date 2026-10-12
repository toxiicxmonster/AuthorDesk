#!/usr/bin/env node
// AuthorDesk sync server. Serves the built app and a private, authenticated sync API.
//
//   node server/index.js                      start (PORT, DATA_DIR, APP_DIR env vars)
//   node server/index.js add-user <name>      create an account (prompts for a passphrase)
//   node server/index.js set-password <name>  change a passphrase (signs out all devices)
//   node server/index.js list-users
//
// Run it behind HTTPS (e.g. Caddy, a cloud host, or `tailscale serve`). Never expose it over plain HTTP
// on the public internet.
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname, normalize, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { openStore } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = resolve(process.env.DATA_DIR || join(here, 'data'));
const APP_DIR = resolve(process.env.APP_DIR || join(here, '..', 'app', 'dist'));
const MAX_BODY = 50 * 1024 * 1024;
const VERSION = '1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.aff': 'text/plain; charset=utf-8', '.dic': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

async function prompt(question, hidden = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    rl._writeToOutput = (s) => rl.output.write(s.includes(question) ? s : '');
  }
  return new Promise((res) => rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); res(a); }));
}

async function cli(cmd, args) {
  await mkdir(DATA_DIR, { recursive: true });
  const store = openStore(join(DATA_DIR, 'authordesk-sync.db'));
  try {
    if (cmd === 'add-user' || cmd === 'set-password') {
      const name = args[0];
      if (!name) throw new Error(`Usage: node server/index.js ${cmd} <username>`);
      const pw = process.env.AUTHORDESK_PASSWORD || (await prompt('Passphrase (10+ characters): ', true));
      if (!process.env.AUTHORDESK_PASSWORD) {
        const again = await prompt('Repeat passphrase: ', true);
        if (pw !== again) throw new Error('Passphrases did not match.');
      }
      if (cmd === 'add-user') store.addUser(name, pw);
      else store.setPassword(name, pw);
      console.log(cmd === 'add-user' ? `User ${name} created.` : `Passphrase changed; all devices signed out.`);
    } else if (cmd === 'list-users') {
      for (const u of store.listUsers()) console.log(`${u.id}\t${u.username}\t${u.created_at}`);
    } else {
      throw new Error(`Unknown command ${cmd}`);
    }
  } finally {
    store.close();
  }
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !(body instanceof Buffer);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(payload);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60_000);
  attempts.set(ip, a);
  return a.length >= 10;
}

export function createApp(store, { appDir = APP_DIR, secureCookies = 'auto' } = {}) {
  const isSecure = (req) => secureCookies === true || (secureCookies === 'auto' && (req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted));
  const cookie = (req, token, maxAge) =>
    `ad_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;

  async function api(req, res, path) {
    // CSRF: every API call must carry a custom header, which cross-site pages cannot send without CORS (never enabled).
    if (req.method !== 'GET' && req.headers['x-authordesk'] !== '1') return send(res, 403, { error: 'Missing X-AuthorDesk header' });
    if (path === '/api/status' && req.method === 'GET') {
      const s = store.session(cookies(req).ad_session);
      return send(res, 200, { server: 'authordesk-sync', version: VERSION, signedIn: !!s, username: s?.username ?? null });
    }
    if (path === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || '';
      if (rateLimited(ip)) return send(res, 429, { error: 'Too many attempts. Wait 15 minutes.' });
      const body = await readJson(req);
      const token = store.login(body.username, body.password, body.device);
      if (!token) {
        attempts.get(ip).push(Date.now());
        return send(res, 401, { error: 'Wrong username or passphrase.' });
      }
      return send(res, 200, { ok: true, username: String(body.username) }, { 'Set-Cookie': cookie(req, token, 30 * 86400) });
    }
    const token = cookies(req).ad_session;
    const session = store.session(token);
    if (!session) return send(res, 401, { error: 'Not signed in' });
    if (path === '/api/logout' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.everywhere) store.logoutEverywhere(session.userId);
      else store.logout(token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
    }
    if (path === '/api/sync/pull' && req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      return send(res, 200, store.pull(session.userId, url.searchParams.get('since') || '0', Number(url.searchParams.get('limit') || 500)));
    }
    if (path === '/api/sync/push' && req.method === 'POST') {
      const body = await readJson(req);
      if (!Array.isArray(body.changes) || body.changes.length > 1000) return send(res, 400, { error: 'changes must be an array (max 1000)' });
      return send(res, 200, store.push(session.userId, body.changes, body.device));
    }
    if (path === '/api/sync/delete-project' && req.method === 'POST') {
      const body = await readJson(req);
      if (typeof body.projectId !== 'string') return send(res, 400, { error: 'projectId required' });
      return send(res, 200, store.deleteProject(session.userId, body.projectId));
    }
    if (path === '/api/sync/stats' && req.method === 'GET') return send(res, 200, store.stats(session.userId));
    return send(res, 404, { error: 'Not found' });
  }

  async function staticFile(req, res, path) {
    if (!existsSync(join(appDir, 'index.html'))) return send(res, 404, 'App not built. Run npm run build in app/.');
    let file = normalize(join(appDir, decodeURIComponent(path === '/' ? '/index.html' : path)));
    if (!file.startsWith(appDir + sep) && file !== appDir) return send(res, 403, 'Forbidden');
    try {
      if (!(await stat(file)).isFile()) file = join(appDir, 'index.html');
    } catch {
      file = join(appDir, 'index.html');
    }
    const immutable = file.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(await readFile(file));
  }

  return createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://x').pathname;
      if (path.startsWith('/api/')) return await api(req, res, path);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return await staticFile(req, res, path);
    } catch (e) {
      // Never log request bodies (they contain manuscript text).
      console.error(`${req.method} ${req.url?.split('?')[0]} failed: ${e.message}`);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd) {
    cli(cmd, args).catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
  } else {
    await mkdir(DATA_DIR, { recursive: true });
    const store = openStore(join(DATA_DIR, 'authordesk-sync.db'));
    if (!store.listUsers().length) console.warn('No users yet. Create one: node server/index.js add-user <name>');
    setInterval(() => store.purgeExpired(), 3600_000).unref();
    createApp(store).listen(PORT, HOST, () => console.log(`AuthorDesk sync server on http://${HOST}:${PORT} (data: ${DATA_DIR})`));
  }
}
