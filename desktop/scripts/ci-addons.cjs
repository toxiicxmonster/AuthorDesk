'use strict';
// CI check of the add-on installers on this system: installs the grammar engine without its 9 GB n-gram data and
// checks a sentence with it, then unpacks the CPU build of llama.cpp and runs it (the model is too large for CI).
//   AUTHORDESK_DATA=/tmp/ad node scripts/ci-addons.cjs
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const installers = require('../src/installers.cjs');
const { isWindows } = require('../src/paths.cjs');

async function main() {
  await installers.installGrammar({ skipNgrams: true, logStream: process.stdout });
  const dir = installers.grammarDir();
  const java = path.join(dir, 'jre', 'bin', isWindows ? 'java.exe' : 'java');
  const jar = path.join(dir, 'languagetool', 'languagetool-server.jar');
  const lt = spawn(java, ['-cp', jar, 'org.languagetool.server.HTTPServer', '--port', '47821'], { stdio: 'ignore' });
  let result = null;
  for (let i = 0; i < 120 && !result; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const r = await fetch('http://127.0.0.1:47821/v2/check', { method: 'POST', body: new URLSearchParams({ language: 'en-US', text: 'She go to the store yesterday.' }) });
      if (r.ok) result = await r.json();
    } catch {
      /* still starting */
    }
  }
  lt.kill();
  if (!result?.matches?.length) throw new Error('The grammar engine found nothing in a wrong sentence.');
  console.log('Grammar engine OK:', result.matches[0].message);

  const build = installers.LLAMA_BUILDS[isWindows ? 'win' : 'linux'].cpu[0];
  const dl = path.join(installers.aiDir(), 'downloads');
  fs.mkdirSync(dl, { recursive: true });
  const step = new installers.Step(installers.aiDir(), process.stdout);
  const file = await installers.download(`https://github.com/ggml-org/llama.cpp/releases/download/b11606/${build.file}`, path.join(dl, build.file), step, 'llama.cpp');
  if ((await installers.sha256(file)) !== build.sha) throw new Error('llama.cpp checksum mismatch');
  const out = path.join(installers.aiDir(), 'llama');
  await installers.extract(file, out);
  const find = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isFile() && e.name === installers.exe('llama-server')) return p;
      if (e.isDirectory()) {
        const f = find(p);
        if (f) return f;
      }
    }
    return null;
  };
  const server = find(out);
  if (!server) throw new Error('llama-server not found');
  const version = execFileSync(server, ['--version'], { env: { ...process.env, LD_LIBRARY_PATH: path.dirname(server) }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  console.log('llama.cpp OK:', (version || '').trim().split('\n')[0]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
