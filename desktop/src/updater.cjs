'use strict';
// Updates a release install to the newest GitHub release, in the background. Books are never in the install
// folder (they live in the app's storage under the data folder), so updates can't touch them.
//   Windows (the unzipped folder): the new files are unpacked next to the install; once AuthorDesk closes, a small
//     helper swaps them in (running files can't be replaced) and keeps the old ones as *.old until the next start.
//   Linux AppImage: the new AppImage replaces the old file straight away (Linux allows that while it runs).
//   Other Linux installs (.deb): only says that a new version is out, with a link to it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { isWindows, dataDir, log } = require('./paths.cjs');
const { download, extract, Step } = require('./installers.cjs');

const REPO = 'toxiicxmonster/AuthorDesk';

/** Compares dotted versions numerically ("0.10" > "0.9"; "0.2" == "0.2.0"). */
function compareVersions(a, b) {
  const x = String(a).replace(/^v/i, '').split('.');
  const y = String(b).replace(/^v/i, '').split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = parseInt(x[i] ?? '0', 10) || 0;
    const q = parseInt(y[i] ?? '0', 10) || 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** How this copy was installed, which decides how it updates. */
function installKind(execDir) {
  if (process.env.APPIMAGE) return 'appimage';
  if (isWindows && fs.existsSync(path.join(execDir, 'dist', 'index.html'))) return 'windows-folder';
  return 'other';
}

/** The asset this kind of install updates from. */
function assetFor(kind, assets) {
  const pick = (re) => assets.find((a) => re.test(a.name));
  if (kind === 'windows-folder') return pick(/-windows\.zip$/i);
  if (kind === 'appimage') return pick(/-linux-x86_64\.AppImage$/i);
  return null;
}

async function latestRelease() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'AuthorDesk-updater', Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const j = await r.json();
  return { tag: j.tag_name, url: j.html_url, assets: (j.assets ?? []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })) };
}

/** Removes what the last update left behind (*.old next to the install, and the staging folder). */
function cleanupOldUpdate(execDir) {
  try {
    for (const name of fs.readdirSync(execDir)) if (name.endsWith('.old')) fs.rmSync(path.join(execDir, name), { recursive: true, force: true });
  } catch {
    /* next time */
  }
}

/**
 * Windows: after AuthorDesk exits, move each new item in (the old one becomes *.old), put everything back if any
 * step fails, then start the new version if asked. PowerShell ships with every Windows.
 */
function windowsSwapScript(staged, installDir, pid, relaunch) {
  const q = (s) => `'${s.replace(/'/g, "''")}'`;
  return `$ErrorActionPreference = 'Stop'
try { Wait-Process -Id ${pid} -Timeout 120 -ErrorAction SilentlyContinue } catch { }
Start-Sleep -Milliseconds 500
$from = ${q(staged)}; $to = ${q(installDir)}
$done = @()
try {
  foreach ($item in Get-ChildItem -LiteralPath $from -Force) {
    if ($item.Name -ieq 'sync-server.txt') { continue }
    $dest = Join-Path $to $item.Name
    $backup = $null
    if (Test-Path -LiteralPath $dest) {
      $backup = "$dest.old"
      if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
      Move-Item -LiteralPath $dest -Destination $backup
    }
    $done += ,@($dest, $backup)
    Move-Item -LiteralPath $item.FullName -Destination $dest
  }
  Remove-Item -LiteralPath (Split-Path $from) -Recurse -Force -ErrorAction SilentlyContinue
} catch {
  for ($i = $done.Count - 1; $i -ge 0; $i--) {
    try {
      if (Test-Path -LiteralPath $done[$i][0]) { Remove-Item -LiteralPath $done[$i][0] -Recurse -Force }
      if ($done[$i][1]) { Move-Item -LiteralPath $done[$i][1] -Destination $done[$i][0] }
    } catch { }
  }
  Add-Content -LiteralPath ${q(path.join(dataDir(), 'launcher.log'))} -Value ("$(Get-Date -Format s) Update failed: " + $_.Exception.Message)
}
${relaunch ? `Start-Process -FilePath (Join-Path $to 'AuthorDesk.exe') -WorkingDirectory $to` : ''}
`;
}

/**
 * Checks for a newer release and gets it ready. Calls `onReady({ tag, apply })` when it can be installed (apply(true)
 * restarts into it), or `onNotice({ tag, url })` when this kind of install can't update itself.
 */
async function checkForUpdate({ version, execDir, onReady, onNotice }) {
  cleanupOldUpdate(execDir);
  if (fs.existsSync(path.join(execDir, 'no-auto-update.txt')) || fs.existsSync(path.join(dataDir(), 'no-auto-update.txt'))) return;
  let rel;
  try {
    rel = await latestRelease();
  } catch (e) {
    log(`Update check skipped: ${e.message}`);
    return;
  }
  if (!rel.tag || compareVersions(rel.tag, version) <= 0) return;
  const kind = installKind(execDir);
  const asset = assetFor(kind, rel.assets);
  if (!asset || !asset.url.startsWith(`https://github.com/${REPO}/releases/download/`)) return onNotice?.({ tag: rel.tag, url: rel.url });

  const work = path.join(dataDir(), 'update');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const s = new Step(work, null);
  try {
    const file = await download(asset.url, path.join(work, asset.name), s, `AuthorDesk ${rel.tag}`, asset.size);
    if (asset.size && fs.statSync(file).size !== asset.size) throw new Error('the download is incomplete');
    if (kind === 'appimage') {
      const target = process.env.APPIMAGE;
      const next = `${target}.new`;
      fs.copyFileSync(file, next);
      fs.chmodSync(next, 0o755);
      fs.renameSync(next, target);
      fs.rmSync(work, { recursive: true, force: true });
      log(`Updated to ${rel.tag} (AppImage)`);
      return onReady?.({
        tag: rel.tag,
        apply: (restart) => {
          if (restart) spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
        },
      });
    }
    // Windows folder: unpack now, swap in after exit.
    const unpacked = path.join(work, 'files');
    await extract(file, unpacked);
    let root = unpacked;
    if (!fs.existsSync(path.join(root, 'AuthorDesk.exe'))) {
      const dirs = fs.readdirSync(unpacked, { withFileTypes: true }).filter((d) => d.isDirectory());
      if (dirs.length === 1) root = path.join(unpacked, dirs[0].name);
    }
    if (!fs.existsSync(path.join(root, 'AuthorDesk.exe')) || !fs.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('the release package is incomplete');
    fs.rmSync(file, { force: true });
    log(`Update ${rel.tag} downloaded; installs when AuthorDesk closes`);
    let applied = false;
    return onReady?.({
      tag: rel.tag,
      apply: (restart) => {
        if (applied) return;
        applied = true;
        const script = path.join(os.tmpdir(), `authordesk-update-${Date.now()}.ps1`);
        fs.writeFileSync(script, windowsSwapScript(root, execDir, process.pid, restart));
        spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        }).unref();
      },
    });
  } catch (e) {
    log(`Update to ${rel.tag} failed: ${e.message}`);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { compareVersions, installKind, assetFor, checkForUpdate, cleanupOldUpdate, windowsSwapScript };
