'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');

// Everything under a throwaway data folder, on a test port.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'authordesk-test-'));
process.env.AUTHORDESK_DATA = path.join(tmp, 'data');
process.env.AUTHORDESK_PORT = '47899';

const backup = require('../src/backup.cjs');
const updater = require('../src/updater.cjs');
const installers = require('../src/installers.cjs');
const migration = require('../src/migration.cjs');
const { createHandler } = require('../src/server.cjs');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('backup file names are safe on Windows and Linux', () => {
  assert.equal(backup.safeFileName('  What: "a" <story>?.  ', 80), 'What a story');
  assert.equal(backup.safeFileName('', 80), 'Untitled');
});

test('backups are saved per book, named by time, and pruned', () => {
  const folder = path.join(tmp, 'backups');
  backup.writeConfig(folder, true);
  const zip = Buffer.from('PK\u0003\u0004 not really a zip');
  for (let d = 0; d < 40; d++) backup.save('bc8f4cc6-dbad', 'My Book', zip, new Date(2026, 9, 1 + d, 9, 0));
  const st = backup.status();
  const b = st.books['bc8f4cc6'];
  assert.equal(b.title, 'My Book');
  assert.ok(b.file.endsWith('My Book 2026-11-09 0900.authorproj'));
  // 40 daily backups: the newest 30 days are kept daily, older ones weekly.
  assert.ok(b.count < 40 && b.count >= 30, `kept ${b.count}`);
  assert.throws(() => backup.save('x', 'y', Buffer.from('nope')), /Not a backup archive/);
  // Renaming the book renames its folder.
  backup.save('bc8f4cc6-dbad', 'New Title', zip, new Date(2026, 10, 20, 8, 0));
  assert.ok(fs.existsSync(path.join(folder, 'New Title (bc8f4cc6)')));
});

test('a second backup folder gets a copy, and an unplugged one never stops the main backup', () => {
  const main = path.join(tmp, 'b-main');
  const second = path.join(tmp, 'b-second');
  fs.mkdirSync(second, { recursive: true });
  backup.writeConfig(main, true, second);
  const zip = Buffer.from('PK second');
  backup.save('aaaabbbb-1', 'Two Places', zip, new Date(2026, 9, 1, 9, 0));
  assert.equal(backup.listBackups(path.join(second, 'Two Places (aaaabbbb)')).length, 1);
  let st = backup.status();
  assert.equal(st.second.folder, second);
  assert.equal(st.second.ok, true);
  // The drive goes away: the main backup still happens, and the status says why the copy didn't.
  backup.writeConfig(main, true, path.join(tmp, 'unplugged', 'AuthorDesk'));
  backup.save('aaaabbbb-1', 'Two Places', zip, new Date(2026, 9, 1, 10, 0));
  st = backup.status();
  assert.equal(st.books.aaaabbbb.count, 2);
  assert.equal(st.second.ok, false);
  assert.match(st.second.error, /plugged in/);
  assert.ok(!fs.existsSync(path.join(tmp, 'unplugged')), 'nothing created where the drive was');
  // Changing other settings keeps the second folder; turning it off removes it.
  backup.writeConfig(main, false);
  assert.ok(backup.readConfig().second);
  backup.writeConfig(main, true, null);
  assert.equal(backup.readConfig().second, null);
});

test('the window opens where it was left, unless that monitor is gone', () => {
  const windowState = require('../src/windowState.cjs');
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
  fs.writeFileSync(path.join(process.env.AUTHORDESK_DATA, 'window.json'), JSON.stringify({ x: 100, y: 50, width: 1200, height: 800, maximized: true }));
  assert.deepEqual(windowState.loadState(displays), { width: 1200, height: 800, x: 100, y: 50, maximized: true });
  // Left on a second monitor that has since been unplugged: same size, centred by the system.
  fs.writeFileSync(path.join(process.env.AUTHORDESK_DATA, 'window.json'), JSON.stringify({ x: 2500, y: 50, width: 1200, height: 800 }));
  assert.deepEqual(windowState.loadState(displays), { width: 1200, height: 800, maximized: false });
  fs.writeFileSync(path.join(process.env.AUTHORDESK_DATA, 'window.json'), 'nonsense');
  assert.deepEqual(windowState.loadState(displays), { width: 1400, height: 900, maximized: false });
});

test('versions compare numerically and each install updates from its own asset', () => {
  assert.equal(updater.compareVersions('v0.10', '0.9'), 1);
  assert.equal(updater.compareVersions('0.9', '0.9.0'), 0);
  assert.equal(updater.compareVersions('v0.8', '0.9.0'), -1);
  const assets = [{ name: 'AuthorDesk-v0.9-windows.zip' }, { name: 'AuthorDesk-v0.9-linux-x86_64.AppImage' }, { name: 'authordesk_0.9.0_amd64.deb' }];
  assert.equal(updater.assetFor('windows-folder', assets).name, 'AuthorDesk-v0.9-windows.zip');
  assert.equal(updater.assetFor('appimage', assets).name, 'AuthorDesk-v0.9-linux-x86_64.AppImage');
  assert.equal(updater.assetFor('other', assets), null);
});

test('the Windows update helper keeps the author’s sync settings and can roll back', () => {
  const s = updater.windowsSwapScript("C:\\Temp\\it's", 'C:\\AuthorDesk', 123, true);
  assert.match(s, /Wait-Process -Id 123/);
  assert.match(s, /'C:\\Temp\\it''s'/);
  assert.match(s, /sync-server\.txt/);
  assert.match(s, /Start-Process/);
  assert.doesNotMatch(updater.windowsSwapScript('a', 'b', 1, false), /Start-Process/);
});

test('installers check downloads and unpack zip and tar.gz archives', async () => {
  const dir = path.join(tmp, 'arch');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'hello.txt');
  fs.writeFileSync(file, 'hello');
  assert.equal(await installers.sha256(file), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');

  // A one-folder tar.gz.
  const tar = require('tar');
  fs.mkdirSync(path.join(dir, 'src', 'jre', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'jre', 'bin', 'java'), '#!/bin/sh\n', { mode: 0o755 });
  await tar.c({ gzip: true, file: path.join(dir, 'jre.tar.gz'), cwd: path.join(dir, 'src') }, ['jre']);
  await installers.extractSingleFolder(path.join(dir, 'jre.tar.gz'), path.join(dir, 'out-jre'));
  assert.ok(fs.existsSync(path.join(dir, 'out-jre', 'bin', 'java')));

  // A zip (stored, one entry), built by hand.
  const name = Buffer.from('top/a.txt');
  const data = Buffer.from('zip!');
  const crc = zlib.crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const cdOffset = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(cdOffset, 16);
  fs.writeFileSync(path.join(dir, 't.zip'), Buffer.concat([local, name, data, central, name, end]));
  await installers.extractSingleFolder(path.join(dir, 't.zip'), path.join(dir, 'out-zip'));
  assert.equal(fs.readFileSync(path.join(dir, 'out-zip', 'a.txt'), 'utf8'), 'zip!');
});

test('downloads resume where they stopped', async () => {
  const body = Buffer.alloc(100_000, 7);
  const ranges = [];
  const srv = http.createServer((req, res) => {
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    ranges.push(m ? +m[1] : 0);
    if (m) {
      res.writeHead(206, { 'Content-Length': body.length - +m[1] });
      res.end(body.subarray(+m[1]));
    } else {
      res.writeHead(200, { 'Content-Length': body.length });
      res.end(body);
    }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const dir = path.join(tmp, 'dl');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'file.bin');
  fs.writeFileSync(out + '.part', body.subarray(0, 40_000)); // an interrupted earlier try
  const step = new installers.Step(dir, null);
  await installers.download(`http://127.0.0.1:${srv.address().port}/f`, out, step, 'test', body.length);
  srv.close();
  assert.deepEqual(ranges, [40_000]);
  assert.ok(fs.readFileSync(out).equals(body));
});

test('first start copies books from the earlier browser profile once, never over existing storage', () => {
  const data = process.env.AUTHORDESK_DATA;
  const old = path.join(data, 'BrowserProfile', 'Default', 'IndexedDB', migration.ORIGIN_DB);
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'CURRENT'), 'MANIFEST-1');
  fs.writeFileSync(path.join(old, 'LOCK'), '');
  const userData = path.join(tmp, 'userdata');
  const r = migration.copyOldProfile(userData);
  assert.equal(r.copied, true);
  const copied = path.join(userData, 'IndexedDB', 'http_localhost_47899.indexeddb.leveldb');
  assert.ok(fs.existsSync(path.join(copied, 'CURRENT')));
  assert.ok(!fs.existsSync(path.join(copied, 'LOCK')));
  assert.ok(fs.existsSync(path.join(old, 'CURRENT')), 'the original stays');
  migration.recordProjects(userData, 2);
  assert.equal(migration.migrationStatus(userData).projectsAfter, 2);
  // Only once.
  fs.writeFileSync(path.join(copied, 'CURRENT'), 'newer');
  migration.copyOldProfile(userData);
  assert.equal(fs.readFileSync(path.join(copied, 'CURRENT'), 'utf8'), 'newer');
});

let srv;
let base;
before(async () => {
  const root = path.join(tmp, 'dist');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<title>AuthorDesk</title>');
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'x');
  srv = http.createServer(createHandler({ root, execDir: tmp, hooks: { openFolder: () => undefined } }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => srv?.close());

test('the server serves the app, falls back to it for unknown paths, and never escapes its folder', async () => {
  assert.equal(await (await fetch(`${base}/__authordesk_ping`)).text(), 'authordesk');
  const js = await fetch(`${base}/assets/app.js`);
  assert.match(js.headers.get('cache-control'), /immutable/);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal(await (await fetch(`${base}/some/route`)).text(), '<title>AuthorDesk</title>');
  assert.equal(await (await fetch(`${base}/..%2f..%2fdata%2fbackup.json`)).text(), '<title>AuthorDesk</title>');
});

test('the server takes backups and reports add-ons', async () => {
  const save = await fetch(`${base}/backup/save?project=abcdef123&title=Server%20Book`, { method: 'POST', body: Buffer.from('PK\u0003\u0004data') });
  assert.equal(save.status, 200);
  assert.equal((await save.json()).books.abcdef12.title, 'Server Book');
  const file = await fetch(`${base}/backup/file?project=abcdef12`, { method: 'POST' });
  assert.equal(Buffer.from(await file.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  const setup = await (await fetch(`${base}/setup/status`)).json();
  assert.deepEqual(Object.keys(setup.parts).sort(), ['ai', 'grammar']);
  assert.equal(setup.parts.ai.installed, false);
  const ai = await fetch(`${base}/ai/chat`, { method: 'POST', body: '{}' });
  assert.equal(ai.status, 503);
  assert.match((await ai.json()).error, /not installed/);
  assert.equal((await fetch(`${base}/api/sync`)).status, 404);
});
