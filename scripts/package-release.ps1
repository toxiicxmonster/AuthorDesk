# Builds AuthorDesk and packages the release zip that GitHub releases carry and the auto-updater installs.
#   powershell -ExecutionPolicy Bypass -File scripts\package-release.ps1            # test, build, package
#   powershell -ExecutionPolicy Bypass -File scripts\package-release.ps1 -SkipBuild # package what's already built
# The version comes from `const string Version` in launcher\AuthorDesk.cs; the zip is releases\AuthorDesk-v<version>-windows.zip.
param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$m = Select-String -Path (Join-Path $root 'launcher\AuthorDesk.cs') -Pattern 'const string Version = "([^"]+)"'
if (-not $m) { throw 'Could not find the Version constant in launcher\AuthorDesk.cs' }
$version = $m.Matches[0].Groups[1].Value
$name = "AuthorDesk-v$version-windows"

if (-not $SkipBuild) { & (Join-Path $PSScriptRoot 'build.ps1') }
foreach ($need in 'AuthorDesk.exe', 'app\dist\index.html') {
  if (-not (Test-Path (Join-Path $root $need))) { throw "Missing $need; build first." }
}

$out = Join-Path $root 'releases'
$stage = Join-Path $out $name
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force (Join-Path $stage 'scripts') | Out-Null

# The flat layout the launcher and updater expect: AuthorDesk.exe next to dist\.
Copy-Item (Join-Path $root 'AuthorDesk.exe') $stage
Copy-Item -Recurse (Join-Path $root 'app\dist') (Join-Path $stage 'dist')
Copy-Item (Join-Path $root 'sync-server.example.txt') $stage
Copy-Item (Join-Path $root 'scripts\install-grammar-engine.ps1') (Join-Path $stage 'scripts')
Set-Content -Encoding ascii (Join-Path $stage 'README.txt') @(
  "AuthorDesk v$version",
  '',
  'Double-click AuthorDesk.exe to start. Keep it next to the dist folder.',
  'AuthorDesk updates itself to the newest release when it starts (create an empty file',
  'named no-auto-update.txt next to AuthorDesk.exe to turn that off).',
  'Your books are stored in your user profile, not in this folder, so updates never touch them.',
  '',
  'Private grammar engine (recommended, about 9 GB):',
  '  powershell -ExecutionPolicy Bypass -File scripts\install-grammar-engine.ps1',
  '',
  'More: https://github.com/toxiicxmonster/AuthorDesk'
)

$zip = Join-Path $out "$name.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
# bsdtar (ships with Windows 10+) writes standard zips with forward-slash paths.
$items = @(Get-ChildItem $stage | ForEach-Object { $_.Name })
& tar.exe -a -c -f $zip -C $stage @items
if ($LASTEXITCODE) { throw 'Could not create the zip' }
Write-Host "Packaged $zip"
