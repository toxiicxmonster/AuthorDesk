# Builds the web app and the AuthorDesk.exe launcher.
#   powershell -ExecutionPolicy Bypass -File scripts\build.ps1            # full build
#   powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -SkipApp   # launcher only
param([switch]$SkipApp, [switch]$SkipTests)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $root 'launcher\AuthorDesk.ico'))) {
  & (Join-Path $PSScriptRoot 'make-icons.ps1')
}

if (-not $SkipApp) {
  Push-Location (Join-Path $root 'app')
  try {
    if (-not (Test-Path 'node_modules')) { npm install; if ($LASTEXITCODE) { throw 'npm install failed' } }
    if (-not $SkipTests) { npm test; if ($LASTEXITCODE) { throw 'Tests failed; not building.' } }
    npm run build; if ($LASTEXITCODE) { throw 'App build failed' }
  } finally { Pop-Location }
}

# The .NET Framework 4 C# compiler ships with Windows; no SDK needed.
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'Could not find csc.exe (.NET Framework 4).' }

$exe = Join-Path $root 'AuthorDesk.exe'
$running = Get-Process -Name 'AuthorDesk' -ErrorAction SilentlyContinue
if ($running) { throw 'AuthorDesk.exe is running. Quit it from the tray icon, then build again.' }

& $csc /nologo /target:winexe /optimize+ /platform:anycpu `
  "/out:$exe" `
  "/win32icon:$(Join-Path $root 'launcher\AuthorDesk.ico')" `
  /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
  /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:System.Web.Extensions.dll `
  (Join-Path $root 'launcher\AuthorDesk.cs')
if ($LASTEXITCODE) { throw 'Launcher build failed' }
Write-Host "Built $exe"
