'use strict';
// Bringing books over from the earlier Windows launcher, which kept them in a private Edge/Chrome profile
// (<data>/BrowserProfile). On the first start, that profile's storage for http://localhost:47820 is copied into this
// app's own storage; the original is left exactly as it was. If the copy can't be read (the browser was newer than
// this app's engine, say), the app offers to bring the books in from the automatic backups instead.
const fs = require('node:fs');
const path = require('node:path');
const { dataDir, log } = require('./paths.cjs');

// The earlier launcher's address; this app's storage is under the same one (another port only in tests).
const ORIGIN_DB = 'http_localhost_47820.indexeddb.leveldb';
const ORIGIN_BLOBS = 'http_localhost_47820.indexeddb.blob';
const port = () => Number(process.env.AUTHORDESK_PORT) || 47820;
const targetDb = () => `http_localhost_${port()}.indexeddb.leveldb`;
const targetBlobs = () => `http_localhost_${port()}.indexeddb.blob`;

const oldProfile = () => path.join(dataDir(), 'BrowserProfile', 'Default');
const markerFile = (userData) => path.join(userData, 'migrated-from-browser.json');

/** True when the earlier launcher's profile has books stored for AuthorDesk's address. */
function hasOldData() {
  return fs.existsSync(path.join(oldProfile(), 'IndexedDB', ORIGIN_DB));
}

/**
 * Copies the old profile's AuthorDesk storage into `userData`, once, and only when this app has no storage of its
 * own yet (so nothing written here is ever overwritten). Returns what happened.
 */
function copyOldProfile(userData) {
  const marker = markerFile(userData);
  if (fs.existsSync(marker)) return JSON.parse(fs.readFileSync(marker, 'utf8'));
  const result = { attempted: false, copied: false, at: new Date().toISOString(), error: '' };
  const target = path.join(userData, 'IndexedDB', targetDb());
  if (!hasOldData() || fs.existsSync(target)) {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(marker, JSON.stringify(result));
    return result;
  }
  result.attempted = true;
  try {
    const from = oldProfile();
    fs.mkdirSync(path.join(userData, 'IndexedDB'), { recursive: true });
    fs.cpSync(path.join(from, 'IndexedDB', ORIGIN_DB), target, { recursive: true, filter: (src) => path.basename(src) !== 'LOCK' });
    if (fs.existsSync(path.join(from, 'IndexedDB', ORIGIN_BLOBS))) fs.cpSync(path.join(from, 'IndexedDB', ORIGIN_BLOBS), path.join(userData, 'IndexedDB', targetBlobs()), { recursive: true });
    // Small per-device preferences (remembered page size, panel layout).
    const ls = path.join(from, 'Local Storage', 'leveldb');
    if (fs.existsSync(ls) && !fs.existsSync(path.join(userData, 'Local Storage', 'leveldb')))
      fs.cpSync(ls, path.join(userData, 'Local Storage', 'leveldb'), { recursive: true, filter: (src) => path.basename(src) !== 'LOCK' });
    result.copied = true;
    log('Copied books from the earlier browser profile');
  } catch (e) {
    result.error = e.message;
    log(`Could not copy books from the earlier browser profile: ${e.message}`);
  }
  fs.writeFileSync(marker, JSON.stringify(result));
  return result;
}

/** Records how many books the app found after the copy, so the app can offer the backups if it found none. */
function recordProjects(userData, count) {
  const marker = markerFile(userData);
  try {
    const j = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (j.projectsAfter === undefined) {
      j.projectsAfter = count;
      fs.writeFileSync(marker, JSON.stringify(j));
      if (j.copied) log(`After copying, the app found ${count} book(s)`);
    }
  } catch {
    /* no migration happened */
  }
}

function migrationStatus(userData) {
  try {
    const j = JSON.parse(fs.readFileSync(markerFile(userData), 'utf8'));
    return { ...j, oldProfile: hasOldData() };
  } catch {
    return { attempted: false, copied: false, oldProfile: hasOldData() };
  }
}

module.exports = { hasOldData, copyOldProfile, recordProjects, migrationStatus, ORIGIN_DB };
