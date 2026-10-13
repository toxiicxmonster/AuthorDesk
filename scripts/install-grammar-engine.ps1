# Installs AuthorDesk's private grammar engine: LanguageTool, its English n-gram data and a portable Java runtime.
# Everything goes under %LOCALAPPDATA%\AuthorDesk\grammar-engine; no admin rights needed, nothing is added to PATH.
# The AuthorDesk launcher starts the engine on this computer only (loopback), so checked text never leaves the machine.
#   powershell -ExecutionPolicy Bypass -File scripts\install-grammar-engine.ps1              # full install (~9 GB download)
#   powershell -ExecutionPolicy Bypass -File scripts\install-grammar-engine.ps1 -SkipNgrams  # without n-grams (~300 MB; less accurate)
# Safe to re-run: finished steps are skipped and interrupted downloads resume.
param([switch]$SkipNgrams)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$dest = Join-Path $env:LOCALAPPDATA 'AuthorDesk\grammar-engine'
$dl = Join-Path $dest 'downloads'
New-Item -ItemType Directory -Force $dl | Out-Null

# Progress for the AuthorDesk launcher, which shows it in the app while installing in the background.
$progressFile = Join-Path $dest 'progress.json'
function Progress([string]$step, [string]$file = '', [long]$total = 0) {
  @{ step = $step; file = $file; total = $total } | ConvertTo-Json -Compress | Set-Content -Encoding ascii $progressFile
}
function RemoteSize([string]$url) {
  try {
    $m = & curl.exe -sIL $url 2>$null | Select-String -Pattern '^content-length:\s*(\d+)' | Select-Object -Last 1
    if ($m) { return [long]$m.Matches[0].Groups[1].Value }
  } catch { }
  return 0
}

$JavaUrl = 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk'
$LtUrl = 'https://languagetool.org/download/LanguageTool-stable.zip'
$NgramUrl = 'https://languagetool.org/download/ngram-data/ngrams-en-20150817.zip'

function Fetch([string]$url, [string]$file, [string]$label) {
  $out = Join-Path $dl $file
  if (Test-Path $out) { return $out }
  $part = "$out.part"
  Write-Host "Downloading $file ..."
  Progress "Downloading $label" $part (RemoteSize $url)
  # curl.exe ships with Windows 10+; -C - resumes a partial download.
  & curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o $part $url
  if ($LASTEXITCODE) { throw "Download failed ($LASTEXITCODE): $url. Run this script again to resume." }
  Move-Item $part $out
  return $out
}

# Extracts a zip whose contents sit in one top folder, and moves that folder to $target.
function ExtractSingleFolder([string]$zip, [string]$target) {
  $tmp = Join-Path $dest ('extract-' + [guid]::NewGuid().ToString('n'))
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    & tar.exe -xf $zip -C $tmp
    if ($LASTEXITCODE) { throw "Could not extract $zip" }
    $inner = @(Get-ChildItem $tmp -Directory)
    if ($inner.Count -ne 1) { throw "Unexpected layout in $zip" }
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Move-Item $inner[0].FullName $target
  } finally {
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  }
}

# 1. Java runtime (LanguageTool needs Java 17+).
$java = Join-Path $dest 'jre\bin\java.exe'
if (-not (Test-Path $java)) {
  ExtractSingleFolder (Fetch $JavaUrl 'jre.zip' 'Java runtime') (Join-Path $dest 'jre')
}
Write-Host 'Java runtime ready.'

# 2. LanguageTool server.
$ltDir = Join-Path $dest 'languagetool'
if (-not (Test-Path (Join-Path $ltDir 'languagetool-server.jar'))) {
  ExtractSingleFolder (Fetch $LtUrl 'LanguageTool-stable.zip' 'LanguageTool') $ltDir
}
Write-Host 'LanguageTool ready.'

# 3. English n-gram data: lets LanguageTool catch confused words ("their/there", "affect/effect") from real usage statistics.
$ngramDir = Join-Path $dest 'ngrams'
if (-not $SkipNgrams -and -not (Test-Path (Join-Path $ngramDir 'en'))) {
  $zip = Fetch $NgramUrl 'ngrams-en.zip' 'English usage data'
  Write-Host 'Extracting n-gram data (several minutes) ...'
  Progress 'Unpacking English usage data (several minutes)'
  $tmp = "$ngramDir.partial"
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory -Force $tmp | Out-Null
  & tar.exe -xf $zip -C $tmp
  if ($LASTEXITCODE) { throw "Could not extract $zip" }
  if (-not (Test-Path (Join-Path $tmp 'en'))) { throw 'Unexpected n-gram layout (no en folder).' }
  if (Test-Path $ngramDir) { Remove-Item -Recurse -Force $ngramDir }
  Move-Item $tmp $ngramDir
  Remove-Item $zip  # 8 GB we no longer need
}

# 4. Server settings read by the launcher.
$props = @('# Written by install-grammar-engine.ps1', 'maxTextLength=60000', 'cacheSize=2000', 'pipelineCaching=true')
if (Test-Path (Join-Path $ngramDir 'en')) { $props += 'languageModel=' + ($ngramDir -replace '\\', '/') }
Set-Content -Encoding ascii (Join-Path $dest 'server.properties') $props

Remove-Item -Recurse -Force $dl -ErrorAction SilentlyContinue
Write-Host ''
Progress 'Done'
Write-Host "Grammar engine installed in $dest"
if (Test-Path (Join-Path $ngramDir 'en')) { Write-Host 'With English n-gram data.' } else { Write-Host 'Without n-gram data (run again without -SkipNgrams to add it).' }
Write-Host 'If AuthorDesk is open it switches the engine on by itself; otherwise it will next time it starts.'
