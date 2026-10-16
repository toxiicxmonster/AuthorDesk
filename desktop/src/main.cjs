'use strict';
// AuthorDesk desktop app: one window with its own built-in browser engine (no Edge or Chrome needed), on Windows and
// Linux. It serves the built web app on http://localhost:47820 (loopback only), runs the optional add-ons, keeps
// automatic backups, and updates itself.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const { dataDir, findDist, log } = require('./paths.cjs');
const { PORT, startServer, serverRunning } = require('./server.cjs');
const addons = require('./addons.cjs');
const migration = require('./migration.cjs');
const updater = require('./updater.cjs');

const ORIGIN = `http://localhost:${PORT}`;
const SMOKE_TEST = process.argv.includes('--smoke-test');
const execDir = path.dirname(app.getPath('exe'));

// Ubuntu 24.04 and later block the sandbox an AppImage needs; there, run without it rather than not start at all.
// (The .deb installs the sandbox helper properly and keeps it.)
if (process.platform === 'linux' && process.env.APPIMAGE) {
  try {
    if (fs.readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1') app.commandLine.appendSwitch('no-sandbox');
  } catch {
    /* not restricted */
  }
}

// The app's own storage (books, settings) lives with the rest of AuthorDesk's data, not in the roaming profile.
app.setPath('userData', path.join(dataDir(), 'App'));
app.setName('AuthorDesk');

let win = null;
let server = null;
let pendingUpdate = null;

if (!SMOKE_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start).catch((e) => {
    log(`Startup failed: ${e.stack ?? e}`);
    dialog.showErrorBox('AuthorDesk could not start', String(e.message ?? e));
    app.exit(1);
  });
}

async function start() {
  // A self-test always ends, even if something in it never answers.
  if (SMOKE_TEST)
    setTimeout(() => {
      process.stdout.write('SMOKE {"ok":false,"error":"timed out"}\n');
      app.exit(1);
    }, 150_000).unref();

  const root = findDist(execDir, __dirname);
  if (!root) {
    dialog.showErrorBox('AuthorDesk', 'The app files are missing. Download AuthorDesk again from its Releases page.');
    return app.exit(1);
  }

  // The earlier Windows launcher (or anything else) on the same address would stop this one from starting.
  while (await serverRunning()) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: 'AuthorDesk',
      message: 'An earlier version of AuthorDesk is still running.',
      detail: 'Quit it first: right-click the AuthorDesk icon near the clock and choose “Quit AuthorDesk”. Then click Try again.',
      buttons: ['Try again', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 1) return app.exit(0);
  }

  // Books from the earlier version's browser profile, copied once before the app's storage opens.
  const moved = migration.copyOldProfile(app.getPath('userData'));

  try {
    server = await startServer({
      root,
      execDir,
      hooks: {
        chooseFolder: async (current) => {
          const r = await dialog.showOpenDialog(win, { title: 'Choose where AuthorDesk keeps automatic backups', defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
          return r.canceled ? null : r.filePaths[0];
        },
        openFolder: (dir) => shell.openPath(dir),
      },
      migration: () => migration.migrationStatus(app.getPath('userData')),
    });
  } catch (e) {
    log(`Could not start server: ${e.message}`);
    dialog.showErrorBox('AuthorDesk', `AuthorDesk could not start its local server on port ${PORT}.\n\nAnother program may be using that port. Close it and try again.\n\n${e.message}`);
    return app.exit(1);
  }

  if (!SMOKE_TEST) {
    addons.checkAddonUpdates();
    void addons.startGrammar();
  }
  setMenu();
  createWindow(moved);
  if (!SMOKE_TEST && app.isPackaged) setTimeout(checkForUpdate, 10_000);
}

function createWindow(moved) {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 360,
    minHeight: 400,
    title: 'AuthorDesk',
    backgroundColor: '#f7f5f0',
    autoHideMenuBar: true,
    show: !SMOKE_TEST,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false },
  });

  // Links to the web open in the normal browser; Google sign-in (for Google Drive backups) stays in a small window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/accounts\.google\.com\//.test(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true } };
    if (/^https?:\/\//.test(url) && !url.startsWith(ORIGIN)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  // Right-click: cut, copy and paste wherever the app doesn't show its own menu.
  win.webContents.on('context-menu', (_e, p) => {
    const items = [];
    if (p.isEditable) items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { role: 'selectAll' });
    else if (p.selectionText) items.push({ role: 'copy' });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
  win.webContents.on('did-finish-load', () => setTimeout(() => void countBooks(moved), 3000));
  win.webContents.on('render-process-gone', (_e, d) => log(`Window crashed: ${d.reason}`));
  win.on('closed', () => (win = null));
  // A self-test can open a particular page (e.g. #/p/<id>/write/<scene>) to check it.
  void win.loadURL(`${ORIGIN}/${SMOKE_TEST ? (process.env.AUTHORDESK_SMOKE_HASH ?? '') : ''}`);
}

/** After a copy from the earlier version, how many books the app can read (none means: offer the backups). */
async function countBooks(moved) {
  if (!win) return;
  const count = await win.webContents
    .executeJavaScript(
      `(async () => {
        const dbs = await indexedDB.databases();
        if (!dbs.some((d) => d.name === 'authordesk')) return 0;
        return await new Promise((res) => {
          const r = indexedDB.open('authordesk');
          r.onsuccess = () => {
            try {
              const c = r.result.transaction('projects', 'readonly').objectStore('projects').count();
              c.onsuccess = () => { res(c.result); r.result.close(); };
              c.onerror = () => res(-1);
            } catch { res(-1); }
          };
          r.onerror = () => res(-1);
        });
      })()`,
    )
    .catch(() => -1);
  migration.recordProjects(app.getPath('userData'), count);
  if (SMOKE_TEST) smokeResult({ moved, count });
}

async function smokeResult(extra) {
  // Optional: a picture of the window, and a real request to each installed add-on.
  if (process.env.AUTHORDESK_SMOKE_HASH) await new Promise((r) => setTimeout(r, 6000)); // let the page settle (proofreading)
  if (process.env.AUTHORDESK_SMOKE_SHOT) {
    // Without a graphics card (CI) the capture can fail; the test is about the app, not the picture.
    try {
      fs.writeFileSync(process.env.AUTHORDESK_SMOKE_SHOT, (await win.webContents.capturePage()).toPNG());
    } catch (e) {
      extra.screenshotError = String(e.message ?? e);
    }
  }
  if (process.argv.includes('--smoke-addons')) {
    await addons.startGrammar();
    extra.addons = await win.webContents
      .executeJavaScript(
        `(async () => {
          const out = {};
          for (let i = 0; i < 90 && !(await fetch('/grammar/status').then((r) => r.json())).ready; i++) await new Promise((r) => setTimeout(r, 1000));
          const g = await fetch('/grammar/v2/check', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'language=en-US&text=' + encodeURIComponent('She go to the store yesterday.') });
          out.grammar = g.ok ? (await g.json()).matches.map((m) => m.message).slice(0, 2) : 'HTTP ' + g.status;
          const a = await fetch('/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Reply with the single word: ready' }], max_tokens: 8, temperature: 0 }) });
          out.ai = a.ok ? (await a.json()).choices[0].message.content : 'HTTP ' + a.status;
          return out;
        })()`,
      )
      .catch((e) => ({ error: String(e) }));
  }
  const page = await win.webContents
    .executeJavaScript(
      `(async () => ({ href: location.href, title: document.title, text: document.body.innerText.slice(0, 200), ping: await fetch('/__authordesk_ping').then((r) => r.text()), setup: await fetch('/setup/status').then((r) => r.json()) }))()`,
    )
    .catch((e) => ({ error: String(e) }));
  const ok = page.title === 'AuthorDesk' && page.ping === 'authordesk' && /AuthorDesk/.test(page.text ?? '');
  process.stdout.write(`SMOKE ${JSON.stringify({ ok, platform: process.platform, version: app.getVersion(), ...extra, ...page })}\n`);
  app.exit(ok ? 0 : 1);
}

function setMenu() {
  const open = (dir) => () => {
    fs.mkdirSync(dir, { recursive: true });
    void shell.openPath(dir);
  };
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'File', submenu: [{ label: 'Open data folder', click: open(dataDir()) }, ...shortcutItems(), { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
      },
      {
        label: 'Help',
        submenu: [
          { label: 'User guide', click: () => shell.openExternal('https://github.com/toxiicxmonster/AuthorDesk/blob/main/docs/user-guide.md') },
          { label: 'Releases and what’s new', click: () => shell.openExternal('https://github.com/toxiicxmonster/AuthorDesk/releases') },
          { type: 'separator' },
          { label: `AuthorDesk ${app.getVersion()}`, enabled: false },
        ],
      },
    ]),
  );
}

/** Ways to start AuthorDesk without finding its folder: shortcuts on Windows, an applications-menu entry for the AppImage. */
function shortcutItems() {
  if (!app.isPackaged) return [];
  const done = (what) => void dialog.showMessageBox(win, { type: 'info', title: 'AuthorDesk', message: `${what} added.` });
  const failed = (e) => dialog.showErrorBox('AuthorDesk', `That didn’t work: ${e.message ?? e}`);
  if (process.platform === 'win32') {
    const link = (dir) => {
      try {
        const ok = shell.writeShortcutLink(path.join(dir, 'AuthorDesk.lnk'), { target: app.getPath('exe'), cwd: execDir, description: 'AuthorDesk' });
        if (!ok) throw new Error('Windows refused to create the shortcut.');
        return true;
      } catch (e) {
        failed(e);
        return false;
      }
    };
    return [
      { type: 'separator' },
      { label: 'Add a desktop shortcut', click: () => link(app.getPath('desktop')) && done('A desktop shortcut was') },
      { label: 'Add to the Start menu', click: () => link(path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')) && done('AuthorDesk was') },
    ];
  }
  if (process.env.APPIMAGE) {
    return [
      { type: 'separator' },
      {
        label: 'Add to the applications menu',
        click: () => {
          try {
            const share = process.env.XDG_DATA_HOME || path.join(app.getPath('home'), '.local', 'share');
            const icon = path.join(share, 'icons', 'hicolor', '512x512', 'apps', 'authordesk.png');
            fs.mkdirSync(path.dirname(icon), { recursive: true });
            fs.copyFileSync(path.join(__dirname, 'icon.png'), icon);
            fs.mkdirSync(path.join(share, 'applications'), { recursive: true });
            fs.writeFileSync(
              path.join(share, 'applications', 'authordesk.desktop'),
              ['[Desktop Entry]', 'Type=Application', 'Name=AuthorDesk', 'Comment=Private writing studio for novelists', `Exec="${process.env.APPIMAGE}" %U`, 'Icon=authordesk', 'Categories=Office;WordProcessor;', 'Terminal=false', 'StartupWMClass=AuthorDesk', ''].join('\n'),
            );
            done('AuthorDesk was');
          } catch (e) {
            failed(e);
          }
        },
      },
    ];
  }
  return [];
}

async function checkForUpdate() {
  await updater.checkForUpdate({
    version: app.getVersion(),
    execDir,
    onReady: async ({ tag, apply }) => {
      pendingUpdate = apply;
      if (!win) return;
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'AuthorDesk',
        message: `AuthorDesk ${tag} is ready.`,
        detail: 'Restart now to use it, or keep writing: it installs when you close AuthorDesk. Your work is saved either way.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) {
        pendingUpdate = null;
        apply(true);
        app.quit();
      }
    },
    onNotice: async ({ tag, url }) => {
      if (!win) return;
      const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'AuthorDesk',
        message: `AuthorDesk ${tag} is out.`,
        detail: 'This copy can’t update itself. Download the new version from the Releases page; your books stay where they are.',
        buttons: ['Open the Releases page', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) void shell.openExternal(url);
    },
  });
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  addons.stopAll();
  server?.close();
  if (pendingUpdate) pendingUpdate(false);
});
