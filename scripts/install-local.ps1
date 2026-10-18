# Puts the current source (built fresh) into the installed AuthorDesk, so the owner can look at changes in their own
# copy before anything is published. Your books live elsewhere (%LOCALAPPDATA%\AuthorDesk) and aren't touched.
#   powershell -ExecutionPolicy Bypass -File scripts\install-local.ps1            # build, then install
#   powershell -ExecutionPolicy Bypass -File scripts\install-local.ps1 -SkipBuild # install what's already built
# The updater only installs a GitHub release with a higher version than this copy, so it won't undo a local build.
param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $env:LOCALAPPDATA 'Programs\AuthorDesk'
$src = Join-Path $root 'releases\desktop\win-unpacked'

if (-not $SkipBuild) {
  Push-Location (Join-Path $root 'app')
  try { npm run build; if ($LASTEXITCODE) { throw 'The app build failed.' } } finally { Pop-Location }
  Push-Location (Join-Path $root 'desktop')
  try { npx electron-builder --win dir --publish never; if ($LASTEXITCODE) { throw 'The desktop package failed.' } } finally { Pop-Location }
}
if (-not (Test-Path (Join-Path $src 'AuthorDesk.exe'))) { throw "Nothing built yet in $src." }
if (-not (Test-Path (Join-Path $dest 'AuthorDesk.exe'))) { throw "AuthorDesk isn't installed in $dest." }

$open = @(Get-Process AuthorDesk -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dest*" })
$version = (Get-Content (Join-Path $src 'resources\app\package.json') -Raw | ConvertFrom-Json).version

# The pages (dist) and the desktop app's code (resources\app) are replaced exactly; files the owner may have put next
# to the app (no-auto-update.txt, sync-server.txt) are kept.
robocopy (Join-Path $src 'dist') (Join-Path $dest 'dist') /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the pages failed (robocopy $LASTEXITCODE)." }
robocopy (Join-Path $src 'resources\app') (Join-Path $dest 'resources\app') /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the desktop code failed (robocopy $LASTEXITCODE)." }
if ($open.Count -eq 0) {
  # Closed: everything else too (Electron itself, when its version changes).
  robocopy $src $dest /E /XD dist app /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying the app failed (robocopy $LASTEXITCODE)." }
  Write-Host "Installed AuthorDesk $version (local build) in $dest." -ForegroundColor Green
} else {
  Write-Host "Installed AuthorDesk $version (local build). It's open: press Ctrl+R in it (or click Reload when it offers) to see the new version." -ForegroundColor Green
  Write-Host 'Changes to the desktop shell itself (menus, updater, add-ons) need AuthorDesk closed and started again.'
}
