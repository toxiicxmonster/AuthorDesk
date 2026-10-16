'use strict';
// Run inside Electron (CI): unpacks a zip that contains an .asar file the way the updater does. Electron's own fs
// treats any '*.asar' path as an archive, which once stopped updates from installing ("Invalid package").
//   ZIP=<a zip containing resources/app.asar> OUT=<empty folder> electron tests/electron-unpack
const path = require('node:path');
const { app } = require('electron');
app.whenReady().then(async () => {
  const { extract } = require('../../src/installers.cjs');
  try {
    await extract(process.env.ZIP, process.env.OUT);
    const ofs = require('original-fs');
    const ok = ofs.statSync(path.join(process.env.OUT, 'resources', 'app.asar')).isFile();
    console.log(ok ? 'UNPACK OK' : 'UNPACK FAILED: not a file');
    app.exit(ok ? 0 : 1);
  } catch (e) {
    console.log(`UNPACK FAILED: ${e.message}`);
    app.exit(1);
  }
});
