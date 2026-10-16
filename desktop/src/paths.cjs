'use strict';
// Where AuthorDesk keeps things on each system, and the shared log.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const isWindows = process.platform === 'win32';

/**
 * Per-user data: add-ons, settings, logs and the app's own storage. On Windows it's the same folder the earlier
 * launcher used (%LOCALAPPDATA%\AuthorDesk), so installed add-ons and backup settings carry over.
 */
function dataDir() {
  if (process.env.AUTHORDESK_DATA) return process.env.AUTHORDESK_DATA;
  if (isWindows) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AuthorDesk');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'AuthorDesk');
}

/** The user's Documents folder (for the default backup location). */
function documentsDir() {
  if (!isWindows) {
    // xdg-user-dirs writes the localized name to ~/.config/user-dirs.dirs.
    try {
      const conf = fs.readFileSync(path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'user-dirs.dirs'), 'utf8');
      const m = /^XDG_DOCUMENTS_DIR="(.+)"$/m.exec(conf);
      if (m) return m[1].replace('$HOME', os.homedir());
    } catch {
      /* no xdg config */
    }
  }
  return path.join(os.homedir(), 'Documents');
}

/** The built web app: next to the executable in a release, or app/dist in a source checkout. */
function findDist(execDir, sourceDir) {
  const candidates = [path.join(execDir, 'dist'), path.join(execDir, 'resources', 'dist'), path.join(sourceDir, '..', '..', 'app', 'dist')];
  if (process.resourcesPath) candidates.splice(1, 0, path.join(process.resourcesPath, 'dist'));
  return candidates.find((c) => fs.existsSync(path.join(c, 'index.html'))) ?? null;
}

let logFile = null;
function log(msg) {
  try {
    logFile = logFile ?? path.join(dataDir(), 'launcher.log');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${new Date().toISOString().slice(0, 19)} ${msg}${os.EOL}`);
  } catch {
    /* logging must never break the app */
  }
}

module.exports = { isWindows, dataDir, documentsDir, findDist, log };
