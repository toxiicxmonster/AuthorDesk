# Installs (or updates) AuthorDesk's private grammar engine: LanguageTool, its English n-gram data and a portable
# Java runtime. Everything goes under %LOCALAPPDATA%\AuthorDesk\grammar-engine; no admin rights needed, nothing is
# added to PATH. The AuthorDesk launcher starts the engine on this computer only (loopback).
#   powershell -ExecutionPolicy Bypass -File scripts\install-grammar-engine.ps1              # full install (~9 GB download)
#   powershell -ExecutionPolicy Bypass -File scripts\install-grammar-engine.ps1 -SkipNgrams  # without n-grams (~300 MB; less accurate)
# Safe to re-run: parts already at the pinned version are kept, interrupted downloads resume, and only parts whose
# pinned version changed are replaced. AuthorDesk runs this automatically when a release pins newer versions.
#   ... -Repair       reinstalls Java and LanguageTool (small), and the n-gram data only if it's missing
param([switch]$SkipNgrams, [switch]$Repair)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# What this script installs. The launcher compares it with the installed version to offer updates; change it
# whenever a pin below changes.
$AddonVersion = 'lt-6.6+ngrams-en-20150817+jre-21.0.12.1'

$JavaVersion = '21.0.12.1+1'
$JavaUrl = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_windows_hotspot_21.0.12.1_1.zip'
$JavaSha = 'd35f31e712f0fcf6ac5a093edc90204fbff22f720ba3950bd09d331d5e621636'
$LtVersion = '6.6'
$LtUrl = 'https://languagetool.org/download/LanguageTool-6.6.zip'
$LtSha = '53600506b399bb5ffe1e4c8dec794fd378212f14aaf38ccef9b6f89314d11631'
# LanguageTool publishes no checksum for the n-gram data (unchanged since 2015), so its exact size is checked instead.
$NgramVersion = 'en-20150817'
$NgramUrl = 'https://languagetool.org/download/ngram-data/ngrams-en-20150817.zip'
$NgramBytes = 8961853713

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

# Which version a part holds (written into the part's folder when it's installed).
function Pinned([string]$dir) { $f = Join-Path $dir 'pinned.txt'; if (Test-Path $f) { (Get-Content $f -Raw).Trim() } else { '' } }
function SetPinned([string]$dir, [string]$version) { Set-Content -Encoding ascii (Join-Path $dir 'pinned.txt') $version }

function Fetch([string]$url, [string]$file, [string]$label, [string]$sha = '', [long]$bytes = 0) {
  $out = Join-Path $dl $file
  if (-not (Test-Path $out)) {
    $part = "$out.part"
    Write-Host "Downloading $file ..."
    Progress "Downloading $label" $part $(if ($bytes) { $bytes } else { RemoteSize $url })
    # curl.exe ships with Windows 10+; -C - resumes a partial download.
    & curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o $part $url
    if ($LASTEXITCODE) { throw "Download failed ($LASTEXITCODE): $url. Run this script again to resume." }
    Move-Item $part $out
  }
  if ($sha) {
    Progress "Checking $label"
    if ((Get-FileHash -Algorithm SHA256 $out).Hash.ToLower() -ne $sha) { Remove-Item $out; throw "$file did not match its published checksum and was deleted. Run the script again." }
  }
  if ($bytes -and (Get-Item $out).Length -ne $bytes) { Remove-Item $out; throw "$file is not the expected size and was deleted. Run the script again." }
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
$jreDir = Join-Path $dest 'jre'
if ((Pinned $jreDir) -ne $JavaVersion -or $Repair) {
  # An earlier install of exactly this build only lacks the record.
  $release = Join-Path $jreDir 'release'
  if (-not $Repair -and (Test-Path $release) -and (Select-String -Path $release -SimpleMatch "JAVA_RUNTIME_VERSION=`"$JavaVersion" -Quiet)) { SetPinned $jreDir $JavaVersion }
  else {
    ExtractSingleFolder (Fetch $JavaUrl 'jre.zip' 'Java runtime' $JavaSha) $jreDir
    SetPinned $jreDir $JavaVersion
  }
}
Write-Host 'Java runtime ready.'

# 2. LanguageTool server.
$ltDir = Join-Path $dest 'languagetool'
if ((Pinned $ltDir) -ne $LtVersion -or $Repair) {
  $jar = Join-Path $ltDir 'languagetool-server.jar'
  $have = ''
  if (Test-Path $jar) {
    try {
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $z = [IO.Compression.ZipFile]::OpenRead($jar)
      $r = New-Object IO.StreamReader($z.GetEntry('META-INF/MANIFEST.MF').Open())
      $m = [regex]::Match($r.ReadToEnd(), 'ComponentVersion:\s*(\S+)')
      $r.Close(); $z.Dispose()
      if ($m.Success) { $have = $m.Groups[1].Value }
    } catch { }
  }
  if ($have -eq $LtVersion -and -not $Repair) { SetPinned $ltDir $LtVersion }
  else {
    ExtractSingleFolder (Fetch $LtUrl "LanguageTool-$LtVersion.zip" 'LanguageTool' $LtSha) $ltDir
    SetPinned $ltDir $LtVersion
  }
}
Write-Host 'LanguageTool ready.'

# 3. English n-gram data: lets LanguageTool catch confused words ("their/there", "affect/effect") from real usage statistics.
$ngramDir = Join-Path $dest 'ngrams'
if (-not $SkipNgrams -and (Pinned $ngramDir) -ne $NgramVersion) {
  if (Test-Path (Join-Path $ngramDir 'en')) { SetPinned $ngramDir $NgramVersion } # the only dataset there has been
  else {
    $zip = Fetch $NgramUrl 'ngrams-en.zip' 'English usage data' '' $NgramBytes
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
    SetPinned $ngramDir $NgramVersion
    Remove-Item $zip  # 8 GB we no longer need
  }
}

# 4. Server settings read by the launcher.
$props = @('# Written by install-grammar-engine.ps1', 'maxTextLength=60000', 'cacheSize=2000', 'pipelineCaching=true')
if (Test-Path (Join-Path $ngramDir 'en')) { $props += 'languageModel=' + ($ngramDir -replace '\\', '/') }
Set-Content -Encoding ascii (Join-Path $dest 'server.properties') $props

Remove-Item -Recurse -Force $dl -ErrorAction SilentlyContinue
Set-Content -Encoding ascii (Join-Path $dest 'installed-version.txt') $(if (Test-Path (Join-Path $ngramDir 'en')) { $AddonVersion } else { "$AddonVersion-no-ngrams" })
Write-Host ''
Progress 'Done'
Write-Host "Grammar engine installed in $dest"
if (Test-Path (Join-Path $ngramDir 'en')) { Write-Host 'With English n-gram data.' } else { Write-Host 'Without n-gram data (run again without -SkipNgrams to add it).' }
Write-Host 'If AuthorDesk is open it switches the engine on by itself; otherwise it will next time it starts.'
