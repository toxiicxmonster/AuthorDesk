'use strict';
// Automatic backups: the app sends a fresh archive of a book after the author has been writing; a rolling set is kept
// on disk, outside the app's storage: <folder>/<Title> (<id>)/<Title> yyyy-MM-dd HHmm.authorproj.
// Settings live in <data>/backup.json (the same file and format the earlier Windows launcher used).
const fs = require('node:fs');
const path = require('node:path');
const { dataDir, documentsDir } = require('./paths.cjs');

const MAX_BACKUP_BYTES = 1024 * 1024 * 1024;

const configPath = () => path.join(dataDir(), 'backup.json');
const defaultFolder = () => path.join(documentsDir(), 'AuthorDesk Backups');

function readConfig() {
  let folder = defaultFolder();
  let enabled = true;
  let second = null;
  try {
    const j = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (typeof j.folder === 'string' && path.isAbsolute(j.folder)) folder = j.folder;
    if (typeof j.enabled === 'boolean') enabled = j.enabled;
    if (typeof j.second === 'string' && path.isAbsolute(j.second)) second = j.second;
  } catch {
    /* defaults */
  }
  return { folder, enabled, second };
}

/** Saves the settings; `second` (an optional second folder that gets a copy of every backup) is kept unless given. */
function writeConfig(folder, enabled, second = readConfig().second) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(second ? { folder, enabled, second } : { folder, enabled }));
}

// How the last copy to the second folder went (it may be a USB drive that isn't plugged in).
let secondResult = null;

/** A name that's safe as a file or folder name on Windows and Linux. */
function safeFileName(s, max) {
  let r = String(s ?? '')
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .trim()
    .replace(/\.+$/, '');
  if (r.length > max) r = r.slice(0, max).trim();
  return r || 'Untitled';
}

function shortId(projectId) {
  const id = safeFileName(projectId ?? '', 64).replace(/ /g, '');
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** The book's folder, found by its id (and renamed to follow the book's current title), or created. */
function bookDir(root, projectId, title, create) {
  const id = shortId(projectId);
  const want = path.join(root, `${safeFileName(title, 80)} (${id})`);
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      const d = path.join(root, name);
      if (!name.toLowerCase().endsWith(`(${id})`.toLowerCase()) || !fs.statSync(d).isDirectory()) continue;
      if (title != null && d.toLowerCase() !== want.toLowerCase()) {
        try {
          fs.renameSync(d, want);
          return want;
        } catch {
          /* keep the old name */
        }
      }
      return d;
    }
  }
  if (create) fs.mkdirSync(want, { recursive: true });
  return want;
}

const BACKUP_NAME = / (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})\.authorproj$/;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;

/** Backups in a book's folder, newest first (only files AuthorDesk named; anything else is left alone). */
function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const m = BACKUP_NAME.exec(name);
    if (m) out.push({ time: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), file: path.join(dir, name) });
  }
  return out.sort((a, b) => b.time - a.time);
}

/** ISO week number, as the earlier launcher grouped weeks (first four-day week, Monday start). */
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-${Math.ceil(((t - yearStart) / 86400000 + 1) / 7)}`;
}

/** Keeps every backup from the last day, one a day for 30 days, one a week after that, and always the newest 5. */
function pruneBackups(dir, now = new Date()) {
  const days = new Set();
  const weeks = new Set();
  listBackups(dir).forEach((b, i) => {
    const age = now - b.time;
    let keep = i < 5 || age < 86400000;
    if (!keep && age < 30 * 86400000) keep = !days.has(stamp(b.time).slice(0, 10)) && !!days.add(stamp(b.time).slice(0, 10));
    else if (!keep) keep = !weeks.has(isoWeek(b.time)) && !!weeks.add(isoWeek(b.time));
    if (!keep) {
      try {
        fs.unlinkSync(b.file);
      } catch {
        /* try again next time */
      }
    }
  });
}

function status() {
  const { folder, enabled, second } = readConfig();
  const books = {};
  try {
    if (fs.existsSync(folder)) {
      for (const name of fs.readdirSync(folder)) {
        const m = /\(([^()]{1,64})\)$/.exec(name);
        if (!m) continue;
        const list = listBackups(path.join(folder, name));
        if (!list.length) continue;
        const bytes = list.reduce((n, b) => n + (fs.statSync(b.file, { throwIfNoEntry: false })?.size ?? 0), 0);
        const t = list[0].time;
        books[m[1]] = { title: name.slice(0, -m[0].length).trim(), last: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}:00`, count: list.length, bytes, file: list[0].file };
      }
    }
  } catch {
    /* an unreadable folder shows as no backups */
  }
  return { enabled, folder, books, second: second ? { folder: second, ...(secondResult ?? { ok: null, at: null, error: '' }) } : null };
}

function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
}

/** Saves one book's archive. Returns the new status, or throws an Error with `status` (HTTP code). */
function save(projectId, title, body, now = new Date()) {
  const { folder, enabled } = readConfig();
  const fail = (code, message) => Object.assign(new Error(message), { status: code });
  if (!enabled) throw fail(409, 'Automatic backups are off.');
  if (!projectId || !body.length || body.length > MAX_BACKUP_BYTES) throw fail(400, 'Bad backup request.');
  // An .authorproj is a zip: refuse anything else.
  if (body[0] !== 0x50 || body[1] !== 0x4b) throw fail(400, 'Not a backup archive.');
  fs.mkdirSync(folder, { recursive: true });
  if (freeBytes(folder) < body.length * 3 + 200 * 1024 * 1024) throw fail(507, 'Not enough free space for backups.');
  const dir = bookDir(folder, projectId, title, true);
  const file = path.join(dir, `${safeFileName(title, 80)} ${stamp(now)}.authorproj`);
  fs.writeFileSync(file + '.part', body);
  fs.renameSync(file + '.part', file);
  pruneBackups(dir, now);
  copyToSecond(projectId, title, body, now);
  return status();
}

/**
 * The same backup into the second folder, kept the same way. Never fails the main backup: a drive that's unplugged
 * or full is reported in the status instead. Only when the folder's drive is there; nothing is created on a drive
 * letter that has gone.
 */
function copyToSecond(projectId, title, body, now) {
  const { second } = readConfig();
  if (!second) return;
  try {
    const root = path.parse(second).root;
    if (!fs.existsSync(root) || !fs.existsSync(path.dirname(second))) throw new Error('The folder isn’t there (is the drive plugged in?)');
    fs.mkdirSync(second, { recursive: true });
    if (freeBytes(second) < body.length * 2 + 50 * 1024 * 1024) throw new Error('Not enough free space there');
    const dir = bookDir(second, projectId, title, true);
    const file = path.join(dir, `${safeFileName(title, 80)} ${stamp(now)}.authorproj`);
    fs.writeFileSync(file + '.part', body);
    fs.renameSync(file + '.part', file);
    pruneBackups(dir, now);
    secondResult = { ok: true, at: now.toISOString(), error: '' };
  } catch (e) {
    secondResult = { ok: false, at: now.toISOString(), error: e.message };
  }
}

module.exports = { readConfig, writeConfig, safeFileName, bookDir, listBackups, pruneBackups, status, save, stamp };
