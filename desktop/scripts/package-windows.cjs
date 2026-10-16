'use strict';
// Packages the Windows build (electron-builder's win-unpacked folder) as releases/AuthorDesk-v<version>-windows.zip:
// AuthorDesk.exe next to dist\, the layout both this app's updater and the earlier launcher's updater install from.
//   npm run dist:win && node scripts/package-windows.cjs
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const desktop = path.join(__dirname, '..');
const { version } = require(path.join(desktop, 'package.json'));
const short = version.replace(/\.0$/, '');
const releases = path.join(desktop, '..', 'releases');
const unpacked = path.join(releases, 'desktop', 'win-unpacked');
for (const need of ['AuthorDesk.exe', path.join('dist', 'index.html'), path.join('resources', 'app.asar')]) {
  if (!fs.existsSync(path.join(unpacked, need))) throw new Error(`Missing ${need} in ${unpacked}; run npm run dist:win first.`);
}

fs.writeFileSync(
  path.join(unpacked, 'README.txt'),
  [
    `AuthorDesk v${short}`,
    '',
    'Double-click AuthorDesk.exe to start. Keep it with the other files in this folder.',
    'It has its own built-in browser engine: no Edge or Chrome needed.',
    'AuthorDesk updates itself when a new version comes out (create an empty file named',
    'no-auto-update.txt next to AuthorDesk.exe to turn that off).',
    'Your books are stored in your user profile (%LOCALAPPDATA%\\AuthorDesk), not in this folder,',
    'so updates never touch them.',
    '',
    'Optional add-ons (the private grammar engine and AI Editor) install from',
    'Settings -> Add-ons inside AuthorDesk.',
    '',
    'More: https://github.com/toxiicxmonster/AuthorDesk',
    '',
  ].join('\r\n'),
);
fs.copyFileSync(path.join(desktop, '..', 'sync-server.example.txt'), path.join(unpacked, 'sync-server.example.txt'));

const zip = path.join(releases, `AuthorDesk-v${short}-windows.zip`);
fs.rmSync(zip, { force: true });
// bsdtar (ships with Windows 10+) writes standard zips with forward-slash paths.
execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', unpacked, ...fs.readdirSync(unpacked)], { stdio: 'inherit' });
console.log(`Packaged ${zip} (${(fs.statSync(zip).size / 1024 ** 2).toFixed(0)} MB)`);
