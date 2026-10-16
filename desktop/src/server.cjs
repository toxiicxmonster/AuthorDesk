'use strict';
// The local server the app window loads: the built web app plus the routes the app uses for backups, add-ons and
// sync, on http://localhost:47820 (loopback only). The address is the same as the earlier Windows launcher's, so
// everything in the app keeps working unchanged.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { dataDir, log } = require('./paths.cjs');
const backup = require('./backup.cjs');
const addons = require('./addons.cjs');

// Fixed: the app's storage belongs to this address, so it must never change (AUTHORDESK_PORT is for tests only).
const PORT = Number(process.env.AUTHORDESK_PORT) || 47820;
const PING_PATH = '/__authordesk_ping';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.aff': 'text/plain; charset=utf-8',
  '.dic': 'text/plain; charset=utf-8',
};

const isLoopback = (a) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';

function send(res, status, body, type = 'application/json') {
  const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length });
  res.end(buf);
}

function readBody(req, max = 1024 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error('Too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** The optional sync server from sync-server.txt (HTTPS, or HTTP on this computer only). */
function readSyncServer(execDir) {
  for (const f of [path.join(dataDir(), 'sync-server.txt'), path.join(execDir, 'sync-server.txt')]) {
    if (!fs.existsSync(f)) continue;
    for (const raw of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      let u;
      try {
        u = new URL(line);
      } catch {
        log('sync-server.txt: not a URL');
        return null;
      }
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
        log('sync-server.txt: refusing non-HTTPS sync server');
        return null;
      }
      return u.origin;
    }
  }
  return null;
}

/** Forwards a request upstream and streams the answer back. */
async function forward(req, res, url, { body, headers = {}, timeout = 120_000, onChunk, rewriteCookies = false, failStatus = 502, failMessage } = {}) {
  let upstream;
  try {
    upstream = await fetch(url, { method: req.method, headers, body: body?.length ? body : undefined, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
  } catch {
    return send(res, failStatus, { error: failMessage });
  }
  const out = { 'Cache-Control': 'no-store' };
  const type = upstream.headers.get('content-type');
  if (type) out['Content-Type'] = type;
  if (rewriteCookies) {
    // Drop any Domain attribute so the cookie belongs to this local origin.
    const cookies = upstream.headers.getSetCookie?.() ?? [];
    if (cookies.length)
      out['Set-Cookie'] = cookies.map((c) =>
        c
          .split(';')
          .map((p) => p.trim())
          .filter((p) => !/^domain=/i.test(p))
          .join('; '),
      );
  }
  res.writeHead(upstream.status, out);
  if (!upstream.body) return res.end();
  const stream = Readable.fromWeb(upstream.body);
  if (onChunk) stream.on('data', onChunk);
  await pipeline(stream, res).catch(() => res.destroy());
}

function serveStatic(req, res, root, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '', 'text/plain');
  let p = urlPath === '/' || urlPath === '' ? '/index.html' : urlPath;
  let full = path.resolve(root, '.' + p);
  if (!full.startsWith(root + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    // Unknown paths fall back to the app shell (routing is hash-based).
    full = path.join(root, 'index.html');
    p = '/index.html';
  }
  const immutable = full.includes(`${path.sep}assets${path.sep}`);
  const buf = fs.readFileSync(full);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': buf.length,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(req.method === 'GET' ? buf : undefined);
}

/**
 * The request handler. `hooks` does what needs the desktop: choosing a backup folder and opening one in the file
 * manager; `migration` reports on bringing books over from the earlier version.
 */
function createHandler({ root, execDir, hooks = {}, migration = () => ({}) }) {
  const syncServer = readSyncServer(execDir);
  return async function handle(req, res) {
    try {
      // Only ever answer this computer.
      if (!isLoopback(req.socket.remoteAddress)) return send(res, 403, '', 'text/plain');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const p = decodeURIComponent(url.pathname);
      const q = url.searchParams;
      if (p === PING_PATH) return send(res, 200, 'authordesk', 'text/plain');

      if (p.startsWith('/backup/')) {
        res.setHeader('Cache-Control', 'no-store');
        if (p === '/backup/status') return send(res, 200, backup.status());
        if (req.method !== 'POST') return send(res, 405, '');
        const { folder, enabled, second } = backup.readConfig();
        if (p === '/backup/save') return send(res, 200, backup.save(q.get('project'), q.get('title') ?? 'Untitled', await readBody(req)));
        if (p === '/backup/settings') {
          const on = q.get('enabled');
          backup.writeConfig(folder, on === null ? enabled : on === '1' || on === 'true');
          return send(res, 200, backup.status());
        }
        if (p === '/backup/choose') {
          // ?which=second picks the folder that gets a second copy of every backup.
          const isSecond = q.get('which') === 'second';
          const chosen = await hooks.chooseFolder?.(isSecond ? (second ?? folder) : folder, isSecond);
          if (chosen && path.isAbsolute(chosen)) {
            if (isSecond && path.resolve(chosen).toLowerCase() === path.resolve(folder).toLowerCase())
              return send(res, 400, { error: 'That’s the main backup folder. Choose a different place, like a USB drive or a cloud folder.' });
            if (isSecond) backup.writeConfig(folder, enabled, chosen);
            else backup.writeConfig(chosen, enabled);
          }
          return send(res, 200, backup.status());
        }
        if (p === '/backup/second/off') {
          backup.writeConfig(folder, enabled, null);
          return send(res, 200, backup.status());
        }
        if (p === '/backup/open') {
          fs.mkdirSync(folder, { recursive: true });
          const project = q.get('project');
          const base = q.get('which') === 'second' && second ? second : folder;
          if (base !== folder && !fs.existsSync(base)) return send(res, 404, { error: 'That folder isn’t there right now.' });
          let target = project ? backup.bookDir(base, project, null, false) : base;
          if (!fs.existsSync(target)) target = base;
          await hooks.openFolder?.(target);
          return send(res, 200, {});
        }
        if (p === '/backup/file' && req.method === 'POST') {
          // The newest backup of a book, for bringing books over from the earlier version.
          const book = backup.status().books[q.get('project') ?? ''];
          if (!book) return send(res, 404, { error: 'No backup of that book.' });
          const buf = fs.readFileSync(book.file);
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length });
          return res.end(buf);
        }
        return send(res, 404, '');
      }

      if (p === '/migration/status') return send(res, 200, migration());
      if (p === '/setup/status') return send(res, 200, addons.setupStatus());
      if (p === '/setup/install' && req.method === 'POST') {
        // Installs what's missing and updates what's out of date (or repairs, with repair=1).
        addons.queueSetup((q.get('parts') ?? '').split(','), { updating: true, repair: q.get('repair') === '1' });
        return send(res, 200, addons.setupStatus());
      }
      if (p === '/setup/log') return send(res, 200, addons.logTail(), 'text/plain; charset=utf-8');

      if (p === '/ai/status') return send(res, 200, await addons.aiStatus());
      if (p === '/ai/start' && req.method === 'POST') {
        void addons.ensureAi();
        return send(res, 200, await addons.aiStatus());
      }
      if (p === '/ai/chat') {
        if (req.method !== 'POST') return send(res, 405, '');
        const body = await readBody(req, 10 * 1024 * 1024);
        if (!(await addons.ensureAi())) {
          const st = await addons.aiStatus();
          return send(res, 503, {
            error: addons.setupBusy('ai') ? 'The AI Editor is being updated. It will be back in a few minutes.' : !st.installed ? 'The AI Editor is not installed.' : 'The AI Editor could not start.',
          });
        }
        return forward(req, res, `http://127.0.0.1:${addons.AI_PORT}/v1/chat/completions`, {
          body,
          headers: { 'Content-Type': 'application/json' },
          timeout: 300_000,
          onChunk: addons.touchAi,
          failMessage: 'The AI Editor stopped responding.',
        });
      }

      if (p === '/grammar/status') return send(res, 200, await addons.grammarStatus());
      if (p === '/grammar/v2/check') {
        if (req.method !== 'POST') return send(res, 405, '');
        return forward(req, res, `http://127.0.0.1:${addons.GRAMMAR_PORT}/v2/check`, {
          body: await readBody(req, 10 * 1024 * 1024),
          headers: { 'Content-Type': req.headers['content-type'] ?? 'application/x-www-form-urlencoded', Accept: 'application/json' },
          timeout: 90_000,
          failStatus: 503,
          failMessage: 'The grammar engine is not running yet.',
        });
      }

      if (p.startsWith('/api/')) {
        if (!syncServer) return send(res, 404, { error: 'No sync server configured' });
        const headers = { 'X-Forwarded-Proto': 'https' };
        for (const h of ['x-authordesk', 'cookie', 'content-type']) if (req.headers[h]) headers[h] = req.headers[h];
        return forward(req, res, syncServer + url.pathname + url.search, {
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req),
          headers,
          rewriteCookies: true,
          failMessage: 'Could not reach the sync server.',
        });
      }

      return serveStatic(req, res, root, p);
    } catch (e) {
      if (e.status) return send(res, e.status, { error: e.message });
      log(`Request failed: ${e.message}`);
      try {
        send(res, 500, { error: e.message });
      } catch {
        res.destroy();
      }
    }
  };
}

/** Is an AuthorDesk (this one or the earlier launcher) already answering on the port? */
async function serverRunning() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}${PING_PATH}`, { signal: AbortSignal.timeout(800) });
    return (await r.text()).trim() === 'authordesk';
  } catch {
    return false;
  }
}

/** Starts listening on 127.0.0.1 (and ::1 where available), so http://localhost:47820 reaches it either way. */
async function startServer(options) {
  const handler = createHandler(options);
  const listen = (host) =>
    new Promise((resolve, reject) => {
      const s = http.createServer(handler);
      s.once('error', reject);
      s.listen(PORT, host, () => resolve(s));
    });
  const servers = [await listen('127.0.0.1')];
  try {
    servers.push(await listen('::1'));
  } catch {
    /* no IPv6 loopback */
  }
  return { close: () => servers.forEach((s) => s.close()) };
}

module.exports = { PORT, PING_PATH, createHandler, startServer, serverRunning, readSyncServer };
