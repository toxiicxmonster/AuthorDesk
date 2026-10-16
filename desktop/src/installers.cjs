'use strict';
// Installers for the optional add-ons (the private AI Editor and grammar engine), for Windows and Linux.
// Everything goes under the AuthorDesk data folder; no admin rights, nothing added to PATH. Safe to re-run: finished
// steps are skipped, interrupted downloads resume, and every download is checked against its published SHA-256.
// They replace the PowerShell scripts the earlier Windows launcher ran, and record the same versions, so add-ons
// installed by those scripts are recognised as up to date.
const crypto = require('node:crypto');
// Inside Electron, plain fs treats any '.asar' file as an archive to read; unpacking an update must write it as a file.
const fs = require(process.versions.electron ? 'original-fs' : 'node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const yauzl = require('yauzl');
const tar = require('tar');
const { isWindows, dataDir } = require('./paths.cjs');

const PLATFORM = isWindows ? 'win' : 'linux';

// ---------------------------------------------------------------- pins

const LLAMA_BUILD = 'b11606';
const LLAMA_BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}`;
const LLAMA_BUILDS = {
  win: {
    cuda: [
      { file: `llama-${LLAMA_BUILD}-bin-win-cuda-12.4-x64.zip`, sha: 'a18ed7ef12a209704335dd7211e6e9958d53e59eec59d20bf2a4341adea016cc' },
      { file: 'cudart-llama-bin-win-cuda-12.4-x64.zip', sha: '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6' },
    ],
    vulkan: [{ file: `llama-${LLAMA_BUILD}-bin-win-vulkan-x64.zip`, sha: 'a70498cb1ba105c4e0abca28e5d784bd6aafbabc870b41237855ffa28a6d6627' }],
    cpu: [{ file: `llama-${LLAMA_BUILD}-bin-win-cpu-x64.zip`, sha: '8c0f4f2a1b808eebe00e738edf027cceea1aa9e6c883618bd37151666093f1b4' }],
  },
  linux: {
    cuda: [
      { file: `llama-${LLAMA_BUILD}-bin-ubuntu-cuda-12.8-x64.tar.gz`, sha: 'e9c03574aba06bc1f6be55e3f26f0fe0dbebbd4822288a1bd77af4681a286ae7' },
      { file: `cudart-llama-${LLAMA_BUILD}-bin-ubuntu-cuda-12.8-x64.tar.gz`, sha: '23588940010242dff9f4cb8d4c56927360336dcc7a3e8af98546a99a33df6999' },
    ],
    vulkan: [{ file: `llama-${LLAMA_BUILD}-bin-ubuntu-vulkan-x64.tar.gz`, sha: '316a23ff1f5dcd071b61de1bfdac06e57f5957f884e1be20d1da3ce10a178be6' }],
    cpu: [{ file: `llama-${LLAMA_BUILD}-bin-ubuntu-x64.tar.gz`, sha: 'd7619f6f3d8d1f6c63641c0904abff560e9dfa8ec0bd5a57e36f424ac96fac55' }],
  },
};
const MODELS = {
  nemo: {
    name: 'Mistral-Nemo-Instruct-2407 (12B)',
    file: 'Mistral-Nemo-Instruct-2407-Q4_K_M.gguf',
    sha: '7c1a10d202d8788dbe5628dc962254d10654c853cae6aaeca0618f05490d4a46',
    url: 'https://huggingface.co/bartowski/Mistral-Nemo-Instruct-2407-GGUF/resolve/main/Mistral-Nemo-Instruct-2407-Q4_K_M.gguf',
  },
  qwen7b: {
    name: 'Qwen2.5-7B-Instruct',
    file: 'Qwen2.5-7B-Instruct-Q5_K_M.gguf',
    sha: '2e998d7e181c8756c5ffc55231b9ee1cdc9d3acec4245d6e27d32bd8e738c474',
    url: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q5_K_M.gguf',
  },
};
/** What the AI Editor installer installs; compared with installed-version.txt to offer updates. */
const AI_VERSION = `llama-${LLAMA_BUILD}+nemo12b-q4km|qwen7b-q5km`;

const JAVA_VERSION = '21.0.12.1+1';
const JAVA = {
  win: { url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip', file: 'jre.zip', sha: 'd35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636' },
  linux: { url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_linux_hotspot_21.0.12.1_1.tar.gz', file: 'jre.tar.gz', sha: '2413149700df0f7d440500a84a8f764c535f21e5a5e87d38328b64eec2c5b500' },
};
const LT_VERSION = '6.6';
const LT = { url: 'https://languagetool.org/download/LanguageTool-6.6.zip', file: 'LanguageTool-6.6.zip', sha: '53600506b399bb5ffe1e4c8dec794fd378212f14aaf38ccef9b6f89314d11631' };
// LanguageTool publishes no checksum for the n-gram data (unchanged since 2015), so its exact size is checked instead.
const NGRAM_VERSION = 'en-20150817';
const NGRAMS = { url: 'https://languagetool.org/download/ngram-data/ngrams-en-20150817.zip', file: 'ngrams-en.zip', bytes: 8961853713 };
/** What the grammar engine installer installs. */
const GRAMMAR_VERSION = `lt-${LT_VERSION}+ngrams-${NGRAM_VERSION}+jre-21.0.12.1`;

const aiDir = () => path.join(dataDir(), 'ai-editor');
const grammarDir = () => path.join(dataDir(), 'grammar-engine');
const exe = (name) => (isWindows ? `${name}.exe` : name);

// ---------------------------------------------------------------- helpers

class Step {
  constructor(dir, logStream) {
    this.dir = dir;
    this.logStream = logStream;
  }
  log(line) {
    this.logStream?.write(line + '\n');
  }
  /** Progress for the app, which shows it while installing in the background. */
  progress(step, file = '', total = 0) {
    fs.writeFileSync(path.join(this.dir, 'progress.json'), JSON.stringify({ step, file, total }));
  }
}

async function remoteSize(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    return Number(r.headers.get('content-length')) || 0;
  } catch {
    return 0;
  }
}

/** Downloads `url` to `out`, resuming a partial `.part` file; up to 5 tries. */
async function download(url, out, s, label, knownSize = 0) {
  if (fs.existsSync(out)) return out;
  const part = out + '.part';
  s.log(`Downloading ${path.basename(out)} ...`);
  s.progress(`Downloading ${label}`, part, knownSize || (await remoteSize(url)));
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
      const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, redirect: 'follow' });
      if (res.status === 416) break; // already complete
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const append = have > 0 && res.status === 206;
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part, { flags: append ? 'a' : 'w' }));
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      s.log(`Download interrupted (${e.message}); retrying ...`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (lastError) throw new Error(`Download failed: ${url} (${lastError.message}). It will pick up where it left off next time.`);
  fs.renameSync(part, out);
  return out;
}

async function sha256(file) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), new Transform({ transform: (c, _e, cb) => (h.update(c), cb()) }));
  return h.digest('hex');
}

async function verify(file, s, label, sha, bytes) {
  if (sha) {
    s.progress(`Checking ${label}`);
    if ((await sha256(file)) !== sha) {
      fs.rmSync(file, { force: true });
      throw new Error(`${path.basename(file)} did not match its published checksum and was deleted. Try again.`);
    }
  }
  if (bytes && fs.statSync(file).size !== bytes) {
    fs.rmSync(file, { force: true });
    throw new Error(`${path.basename(file)} is not the expected size and was deleted. Try again.`);
  }
}

/** Unpacks a .zip, keeping Unix file modes; refuses entries that would land outside `dest`. */
function unzip(file, dest) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        const target = path.resolve(dest, entry.fileName);
        if (!target.startsWith(path.resolve(dest) + path.sep) && target !== path.resolve(dest)) return reject(new Error(`Unsafe path in ${file}`));
        if (/\/$/.test(entry.fileName)) {
          fs.mkdirSync(target, { recursive: true });
          return zip.readEntry();
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const mode = (entry.externalFileAttributes >>> 16) & 0o777;
          pipeline(stream, fs.createWriteStream(target, mode ? { mode } : {}))
            .then(() => zip.readEntry())
            .catch(reject);
        });
      });
      zip.readEntry();
    });
  });
}

async function extract(file, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (file.endsWith('.zip')) await unzip(file, dest);
  else await tar.x({ file, cwd: dest });
}

/** Extracts an archive whose contents sit in one top folder, and moves that folder to `target`. */
async function extractSingleFolder(file, target) {
  const tmp = `${target}.extract`;
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    await extract(file, tmp);
    const inner = fs.readdirSync(tmp, { withFileTypes: true }).filter((d) => d.isDirectory());
    if (inner.length !== 1) throw new Error(`Unexpected layout in ${path.basename(file)}`);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(path.join(tmp, inner[0].name), target);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const readText = (f) => {
  try {
    return fs.readFileSync(f, 'utf8').trim();
  } catch {
    return '';
  }
};
const pinned = (dir) => readText(path.join(dir, 'pinned.txt'));
const setPinned = (dir, v) => fs.writeFileSync(path.join(dir, 'pinned.txt'), v);

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? '' : String(stdout))));
}

/** Which llama.cpp build suits this computer, and how much NVIDIA graphics memory it has. */
async function detectGpu() {
  const nvidia = await run('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits']);
  const vramMb = parseInt(nvidia.split(/\r?\n/)[0], 10) || 0;
  if (vramMb > 0) return { backend: 'cuda', vramMb };
  const names = isWindows
    ? await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'])
    : await run('lspci', []);
  return { backend: /AMD|Radeon|Intel\(R\) Arc|Intel Corporation .*Arc/i.test(names) ? 'vulkan' : 'cpu', vramMb: 0 };
}

/** Finds a file by name anywhere under `dir`. */
function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === name) return p;
    if (e.isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    }
  }
  return null;
}

// ---------------------------------------------------------------- AI Editor

async function installAi({ repair = false, logStream, backend = 'auto', model = 'auto' } = {}) {
  const dest = aiDir();
  const dl = path.join(dest, 'downloads');
  fs.mkdirSync(dl, { recursive: true });
  const s = new Step(dest, logStream);

  let vramMb = 0;
  if (backend === 'auto') ({ backend, vramMb } = await detectGpu());
  if (model === 'auto') model = backend === 'cuda' && vramMb >= 10000 ? 'nemo' : 'qwen7b';
  const m = MODELS[model];
  s.log(`Using the ${backend} build of llama.cpp (${LLAMA_BUILD}) with ${m.name}.`);

  // 1. llama.cpp
  const llamaDir = path.join(dest, 'llama');
  const buildStamp = path.join(llamaDir, 'build.txt');
  if (repair) fs.rmSync(buildStamp, { force: true });
  if (readText(buildStamp) !== `${LLAMA_BUILD} ${backend}`) {
    fs.rmSync(llamaDir, { recursive: true, force: true });
    fs.mkdirSync(llamaDir, { recursive: true });
    for (const b of LLAMA_BUILDS[PLATFORM][backend]) {
      const file = await download(`${LLAMA_BASE}/${b.file}`, path.join(dl, b.file), s, 'llama.cpp');
      await verify(file, s, 'llama.cpp', b.sha);
      await extract(file, llamaDir);
    }
    const server = findFile(llamaDir, exe('llama-server'));
    if (!server) throw new Error(`${exe('llama-server')} was not found in the llama.cpp download.`);
    // Everything in one folder, next to llama-server (the libraries are found there).
    const inner = path.dirname(server);
    if (inner !== llamaDir) {
      for (const name of fs.readdirSync(inner)) fs.renameSync(path.join(inner, name), path.join(llamaDir, name));
    }
    if (!isWindows) fs.chmodSync(path.join(llamaDir, 'llama-server'), 0o755);
    fs.writeFileSync(buildStamp, `${LLAMA_BUILD} ${backend}`);
  }
  s.log('llama.cpp ready.');

  // 2. Model
  const modelDir = path.join(dest, 'models');
  fs.mkdirSync(modelDir, { recursive: true });
  const modelPath = path.join(modelDir, m.file);
  if (repair && fs.existsSync(modelPath)) {
    s.progress('Checking the model');
    if ((await sha256(modelPath)) !== m.sha) {
      s.log('The model file is damaged; downloading it again.');
      fs.rmSync(modelPath, { force: true });
    } else s.log('Model file checked: OK.');
  }
  if (!fs.existsSync(modelPath)) {
    const file = await download(m.url, path.join(dl, m.file), s, `the model (${m.name})`);
    await verify(file, s, `the model (${m.name})`, m.sha);
    fs.renameSync(file, modelPath);
  }
  // A newer pinned model replaces the old one: don't leave gigabytes of it behind.
  for (const f of fs.readdirSync(modelDir)) if (f.endsWith('.gguf') && f !== m.file) fs.rmSync(path.join(modelDir, f), { force: true });
  s.log('Model ready.');

  // 3. Settings read when starting it.
  const config = { model: m.name, file: modelPath, backend, gpuLayers: backend === 'cpu' ? 0 : 99, contextSize: 8192, build: LLAMA_BUILD };
  fs.writeFileSync(path.join(dest, 'ai-editor.json'), JSON.stringify(config, null, 2));
  fs.rmSync(dl, { recursive: true, force: true });
  fs.writeFileSync(path.join(dest, 'installed-version.txt'), AI_VERSION);
  s.progress('Done');
  s.log(`AI Editor installed in ${dest} (${m.name}, ${backend}).`);
}

// ---------------------------------------------------------------- grammar engine

async function installGrammar({ repair = false, skipNgrams = false, logStream } = {}) {
  const dest = grammarDir();
  const dl = path.join(dest, 'downloads');
  fs.mkdirSync(dl, { recursive: true });
  const s = new Step(dest, logStream);

  // 1. Java runtime (LanguageTool needs Java 17+).
  const jreDir = path.join(dest, 'jre');
  if (pinned(jreDir) !== JAVA_VERSION || repair) {
    const j = JAVA[PLATFORM];
    const file = await download(j.url, path.join(dl, j.file), s, 'Java runtime');
    await verify(file, s, 'Java runtime', j.sha);
    await extractSingleFolder(file, jreDir);
    setPinned(jreDir, JAVA_VERSION);
  }
  s.log('Java runtime ready.');

  // 2. LanguageTool server.
  const ltDir = path.join(dest, 'languagetool');
  if (pinned(ltDir) !== LT_VERSION || repair) {
    const file = await download(LT.url, path.join(dl, LT.file), s, 'LanguageTool');
    await verify(file, s, 'LanguageTool', LT.sha);
    await extractSingleFolder(file, ltDir);
    setPinned(ltDir, LT_VERSION);
  }
  s.log('LanguageTool ready.');

  // 3. English n-gram data: lets LanguageTool catch confused words ("their/there") from real usage statistics.
  const ngramDir = path.join(dest, 'ngrams');
  if (!skipNgrams && pinned(ngramDir) !== NGRAM_VERSION) {
    if (fs.existsSync(path.join(ngramDir, 'en'))) setPinned(ngramDir, NGRAM_VERSION); // the only dataset there has been
    else {
      const file = await download(NGRAMS.url, path.join(dl, NGRAMS.file), s, 'English usage data', NGRAMS.bytes);
      await verify(file, s, 'English usage data', null, NGRAMS.bytes);
      s.log('Extracting n-gram data (several minutes) ...');
      s.progress('Unpacking English usage data (several minutes)');
      const tmp = `${ngramDir}.partial`;
      fs.rmSync(tmp, { recursive: true, force: true });
      await extract(file, tmp);
      if (!fs.existsSync(path.join(tmp, 'en'))) throw new Error('Unexpected n-gram layout (no en folder).');
      fs.rmSync(ngramDir, { recursive: true, force: true });
      fs.renameSync(tmp, ngramDir);
      setPinned(ngramDir, NGRAM_VERSION);
      fs.rmSync(file, { force: true }); // 8 GB no longer needed
    }
  }

  // 4. Server settings.
  const hasNgrams = fs.existsSync(path.join(ngramDir, 'en'));
  const props = ['# Written by AuthorDesk', 'maxTextLength=60000', 'cacheSize=2000', 'pipelineCaching=true'];
  if (hasNgrams) props.push('languageModel=' + ngramDir.replace(/\\/g, '/'));
  fs.writeFileSync(path.join(dest, 'server.properties'), props.join('\n') + '\n');
  fs.rmSync(dl, { recursive: true, force: true });
  fs.writeFileSync(path.join(dest, 'installed-version.txt'), hasNgrams ? GRAMMAR_VERSION : `${GRAMMAR_VERSION}-no-ngrams`);
  s.progress('Done');
  s.log(`Grammar engine installed in ${dest}${hasNgrams ? ' with English n-gram data.' : ' without n-gram data.'}`);
}

module.exports = {
  AI_VERSION,
  GRAMMAR_VERSION,
  LLAMA_BUILDS,
  aiDir,
  grammarDir,
  exe,
  installAi,
  installGrammar,
  sha256,
  extract,
  extractSingleFolder,
  download,
  Step,
};
