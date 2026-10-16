'use strict';
// The optional add-ons while AuthorDesk runs: starting and stopping the AI Editor (llama.cpp) and the grammar engine
// (LanguageTool), their status, and installing or updating them in the background.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { isWindows, dataDir, log } = require('./paths.cjs');
const installers = require('./installers.cjs');

const AI_PORT = 47822;
const GRAMMAR_PORT = 47821;
const AI_IDLE_MS = 15 * 60 * 1000;

const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const readText = (f) => {
  try {
    return fs.readFileSync(f, 'utf8').trim();
  } catch {
    return '';
  }
};

async function ok(url, ms = 1000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return r.ok;
  } catch {
    return false;
  }
}

const running = (p) => !!p && p.exitCode === null && !p.killed;

// ---------------------------------------------------------------- AI Editor

const aiServer = () => path.join(installers.aiDir(), 'llama', installers.exe('llama-server'));
let ai = null;
let aiLastUsed = 0;
let aiIdleTimer = null;
let aiStarting = null;

/** The installer's settings (model file, GPU layers, context size), or null when not installed. */
function aiConfig() {
  const cfg = readJson(path.join(installers.aiDir(), 'ai-editor.json'));
  if (!cfg || !fs.existsSync(aiServer()) || typeof cfg.file !== 'string' || !fs.existsSync(cfg.file)) return null;
  return cfg;
}

const aiReady = () => ok(`http://127.0.0.1:${AI_PORT}/health`);

async function aiStatus() {
  const cfg = aiConfig();
  const ready = !!cfg && running(ai) && (await aiReady());
  return { installed: !!cfg, ready, starting: !!cfg && running(ai) && !ready, model: cfg?.model ?? '' };
}

/** Starts the model server if needed and waits (up to 3 minutes) until it has loaded. True when ready. */
async function ensureAi() {
  const cfg = aiConfig();
  if (!cfg || setupBusy('ai')) return false;
  aiLastUsed = Date.now();
  if (!running(ai)) {
    const env = { ...process.env };
    if (!isWindows) env.LD_LIBRARY_PATH = [path.dirname(aiServer()), env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    try {
      ai = spawn(aiServer(), ['-m', cfg.file, '--host', '127.0.0.1', '--port', String(AI_PORT), '-c', String(cfg.contextSize ?? 8192), '-ngl', String(cfg.gpuLayers ?? 0)], {
        cwd: path.dirname(aiServer()),
        env,
        windowsHide: true,
        stdio: 'ignore',
      });
      ai.on('error', (e) => log(`AI Editor failed: ${e.message}`));
      log(`AI Editor started (${cfg.model})`);
    } catch (e) {
      log(`Could not start the AI Editor: ${e.message}`);
      return false;
    }
    aiIdleTimer ??= setInterval(() => {
      if (running(ai) && Date.now() - aiLastUsed > AI_IDLE_MS) {
        log('AI Editor unloaded after being idle');
        stopAi();
      }
    }, 60_000);
  }
  aiStarting ??= (async () => {
    for (let i = 0; i < 360; i++) {
      if (await aiReady()) return true;
      if (!running(ai)) return false;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  })().finally(() => (aiStarting = null));
  return aiStarting;
}

function stopAi() {
  try {
    if (running(ai)) ai.kill();
  } catch {
    /* already gone */
  }
  ai = null;
}

const touchAi = () => (aiLastUsed = Date.now());

// ---------------------------------------------------------------- grammar engine

const grammarJava = () => path.join(installers.grammarDir(), 'jre', 'bin', isWindows ? 'javaw.exe' : 'java');
const grammarJar = () => path.join(installers.grammarDir(), 'languagetool', 'languagetool-server.jar');
const grammarInstalled = () => fs.existsSync(grammarJava()) && fs.existsSync(grammarJar());
const grammarReady = () => ok(`http://127.0.0.1:${GRAMMAR_PORT}/v2/languages`);
let grammar = null;

async function startGrammar() {
  if (!grammarInstalled() || setupBusy('grammar') || running(grammar) || (await grammarReady())) return;
  const props = path.join(installers.grammarDir(), 'server.properties');
  const args = ['-Xms256m', '-Xmx2g', '-cp', grammarJar(), 'org.languagetool.server.HTTPServer', '--port', String(GRAMMAR_PORT)];
  if (fs.existsSync(props)) args.push('--config', props);
  try {
    grammar = spawn(grammarJava(), args, { cwd: path.dirname(grammarJar()), windowsHide: true, stdio: 'ignore' });
    grammar.on('error', (e) => log(`Grammar engine failed: ${e.message}`));
    log('Grammar engine started');
  } catch (e) {
    log(`Could not start grammar engine: ${e.message}`);
  }
}

function stopGrammar() {
  try {
    if (running(grammar)) grammar.kill();
  } catch {
    /* already gone */
  }
  grammar = null;
}

async function grammarStatus() {
  const installed = grammarInstalled();
  const ready = installed && (await grammarReady());
  return {
    installed,
    ngrams: installed && fs.existsSync(path.join(installers.grammarDir(), 'ngrams', 'en')),
    ready,
    starting: installed && !ready && running(grammar),
  };
}

// ---------------------------------------------------------------- setup (install / update / repair)

const parts = {
  ai: { id: 'ai', dir: installers.aiDir, version: installers.AI_VERSION, needGb: 10, install: installers.installAi },
  grammar: { id: 'grammar', dir: installers.grammarDir, version: installers.GRAMMAR_VERSION, needGb: 26, install: installers.installGrammar },
};
for (const p of Object.values(parts)) Object.assign(p, { state: 'idle', message: '', updating: false, repair: false });
const queue = [];
let setupRunning = false;

const partInstalled = (id) => (id === 'ai' ? !!aiConfig() : grammarInstalled() && fs.existsSync(path.join(installers.grammarDir(), 'ngrams', 'en')));
const installedVersion = (p) => readText(path.join(p.dir(), 'installed-version.txt')).replace('-no-ngrams', '');
const updateNeeded = (p) => partInstalled(p.id) && installedVersion(p) !== p.version;
const setupBusy = (id) => parts[id].state === 'queued' || parts[id].state === 'installing';

function freeGb() {
  try {
    const dir = dataDir();
    fs.mkdirSync(dir, { recursive: true });
    const s = fs.statfsSync(dir);
    return Math.floor((s.bavail * s.bsize) / 1024 ** 3);
  } catch {
    return -1;
  }
}

/** Queues installs: what's missing, updates for what's out of date, or a repair of what's installed. */
function queueSetup(ids, { updating = false, repair = false } = {}) {
  for (const raw of ids) {
    const p = parts[String(raw).trim()];
    if (!p) continue;
    const installed = partInstalled(p.id);
    if (installed && !repair && !(updating && updateNeeded(p))) continue;
    if (setupBusy(p.id)) continue;
    Object.assign(p, { state: 'queued', message: '', updating: installed, repair: repair && installed });
    queue.push(p);
  }
  if (!setupRunning && queue.length) void runQueue();
}

async function runQueue() {
  setupRunning = true;
  while (queue.length) {
    const p = queue.shift();
    p.state = 'installing';
    if (p.id === 'grammar') stopGrammar();
    if (p.id === 'ai') stopAi();
    fs.mkdirSync(p.dir(), { recursive: true });
    const logStream = fs.createWriteStream(path.join(dataDir(), `setup-${p.id}.log`));
    try {
      await p.install({ repair: p.repair, logStream });
      const done = partInstalled(p.id) && !updateNeeded(p);
      Object.assign(p, { state: done ? 'done' : 'failed', message: done ? '' : 'The install finished but the add-on is incomplete. Try Repair.' });
      if (done) p.updating = false;
    } catch (e) {
      logStream.write(`${e.stack ?? e}\n`);
      Object.assign(p, { state: 'failed', message: e.message });
    }
    logStream.end();
    log(`Setup ${p.id}: ${p.state}${p.message ? ` (${p.message})` : ''}`);
    if (p.state === 'done' && p.id === 'grammar') void startGrammar();
  }
  setupRunning = false;
}

/** At launch: bring installed add-ons up to the versions this release pins, in the background. */
function checkAddonUpdates() {
  const free = freeGb();
  const ids = [];
  for (const p of Object.values(parts)) {
    if (!updateNeeded(p)) continue;
    if (free >= 0 && free < p.needGb) {
      Object.assign(p, { state: 'failed', message: `An update needs about ${p.needGb} GB free; this computer has ${free} GB. The current version keeps working.` });
      continue;
    }
    log(`Add-on update for ${p.id}: ${installedVersion(p) || '(unrecorded)'} -> ${p.version}`);
    ids.push(p.id);
  }
  if (ids.length) queueSetup(ids, { updating: true });
}

/** The current step and how far through its download it is, from the installer's progress.json. */
function progressOf(p) {
  const j = readJson(path.join(p.dir(), 'progress.json'));
  if (!j) return { step: '', percent: -1 };
  let percent = -1;
  if (j.file && j.total > 0) {
    const have = fs.existsSync(j.file) ? fs.statSync(j.file).size : j.total;
    percent = Math.min(100, Math.floor((have * 100) / j.total));
  }
  return { step: j.step ?? '', percent };
}

function setupStatus() {
  const out = { freeGb: freeGb(), parts: {} };
  for (const p of Object.values(parts)) {
    const installed = partInstalled(p.id);
    const { step, percent } = progressOf(p);
    const busy = p.state === 'installing';
    out.parts[p.id] = {
      installed,
      available: true,
      // "done" only while it's actually installed (files can be removed after an install).
      state: installed && !busy ? 'done' : p.state === 'done' ? 'idle' : p.state,
      step: busy ? step : '',
      percent: busy ? percent : -1,
      message: p.message,
      updating: p.updating,
      updateAvailable: installed && !busy && p.state !== 'queued' && updateNeeded(p),
    };
  }
  return out;
}

/** The end of the app's log and the add-on install logs, for Settings → Add-ons (support). */
function logTail() {
  let out = '';
  for (const name of ['launcher.log', 'setup-grammar.log', 'setup-ai.log']) {
    const f = path.join(dataDir(), name);
    if (!fs.existsSync(f)) continue;
    try {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      out += `== ${name} ==\n${lines.slice(-60).map((l) => l.replace(/\r$/, '')).join('\n')}\n`;
    } catch (e) {
      out += `== ${name}: ${e.message} ==\n`;
    }
  }
  return out || '(no logs yet)';
}

function stopAll() {
  stopAi();
  stopGrammar();
}

module.exports = { AI_PORT, GRAMMAR_PORT, aiStatus, ensureAi, touchAi, grammarStatus, startGrammar, queueSetup, setupStatus, setupBusy, checkAddonUpdates, logTail, stopAll };
