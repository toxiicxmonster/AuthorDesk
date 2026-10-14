# Installs AuthorDesk's private AI Editor: llama.cpp (MIT) and an open-weight Apache-2.0 model, all on this PC.
# Everything goes under %LOCALAPPDATA%\AuthorDesk\ai-editor; no admin rights, no account, nothing added to PATH.
# The AuthorDesk launcher starts it on this computer only (loopback), when the AI Editor is first used.
#   powershell -ExecutionPolicy Bypass -File scripts\install-ai-editor.ps1                 # picks model and build for this PC
#   powershell -ExecutionPolicy Bypass -File scripts\install-ai-editor.ps1 -Model qwen7b   # smaller, faster model
#   powershell -ExecutionPolicy Bypass -File scripts\install-ai-editor.ps1 -Backend cpu    # force a build (cuda, vulkan, cpu)
# Safe to re-run: finished steps are skipped, interrupted downloads resume, every file is checked against its SHA-256.
# AuthorDesk runs this automatically when a release pins a newer llama.cpp build or model.
param([ValidateSet('auto', 'nemo', 'qwen7b')][string]$Model = 'auto', [ValidateSet('auto', 'cuda', 'vulkan', 'cpu')][string]$Backend = 'auto')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$dest = Join-Path $env:LOCALAPPDATA 'AuthorDesk\ai-editor'
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

# What this script installs. The launcher compares it with the installed version to offer updates; change it
# whenever a pin below changes.
$AddonVersion = 'llama-b11606+nemo12b-q4km|qwen7b-q5km'

# Pinned llama.cpp build and model files (SHA-256 from their publishers).
$LlamaBuild = 'b11606'
$LlamaBase = "https://github.com/ggml-org/llama.cpp/releases/download/$LlamaBuild"
$Builds = @{
  cuda   = @(
    @{ file = "llama-$LlamaBuild-bin-win-cuda-12.4-x64.zip"; sha = 'a18ed7ef12a209704335dd7211e6e9958d53e59eec59d20bf2a4341adea016cc' },
    @{ file = 'cudart-llama-bin-win-cuda-12.4-x64.zip'; sha = '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6' }
  )
  vulkan = @(@{ file = "llama-$LlamaBuild-bin-win-vulkan-x64.zip"; sha = 'a70498cb1ba105c4e0abca28e5d784bd6aafbabc870b41237855ffa28a6d6627' })
  cpu    = @(@{ file = "llama-$LlamaBuild-bin-win-cpu-x64.zip"; sha = '8c0f4f2a1b808eebe00e738edf027cceea1aa9e6c883618bd37151666093f1b4' })
}
$Models = @{
  nemo   = @{ name = 'Mistral-Nemo-Instruct-2407 (12B)'; file = 'Mistral-Nemo-Instruct-2407-Q4_K_M.gguf'; sha = '7c1a10d202d8788dbe5628dc962254d10654c853cae6aaeca0618f05490d4a46'
              url = 'https://huggingface.co/bartowski/Mistral-Nemo-Instruct-2407-GGUF/resolve/main/Mistral-Nemo-Instruct-2407-Q4_K_M.gguf' }
  qwen7b = @{ name = 'Qwen2.5-7B-Instruct'; file = 'Qwen2.5-7B-Instruct-Q5_K_M.gguf'; sha = '2e998d7e181c8756c5ffc55231b9ee1cdc9d3acec4245d6e27d32bd8e738c474'
              url = 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q5_K_M.gguf' }
}

function Fetch([string]$url, [string]$file, [string]$sha, [string]$label) {
  $out = Join-Path $dl $file
  if (-not (Test-Path $out)) {
    $part = "$out.part"
    Write-Host "Downloading $file ..."
    Progress "Downloading $label" $part (RemoteSize $url)
    & curl.exe -L --fail --retry 5 --retry-delay 5 -C - -o $part $url
    if ($LASTEXITCODE) { throw "Download failed ($LASTEXITCODE): $url. Run this script again to resume." }
    Move-Item $part $out
  }
  Progress "Checking $label"
  $actual = (Get-FileHash -Algorithm SHA256 $out).Hash.ToLower()
  if ($actual -ne $sha) {
    Remove-Item $out
    throw "$file did not match its published checksum and was deleted. Run the script again."
  }
  return $out
}

# 1. Which build and model suit this PC.
$vramMb = 0
$nvidia = $null
try { $nvidia = & nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null } catch { }
if ($nvidia) { $vramMb = [int](($nvidia | Select-Object -First 1).Trim()) }
if ($Backend -eq 'auto') {
  if ($vramMb -gt 0) { $Backend = 'cuda' }
  elseif (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'AMD|Radeon|Intel\(R\) Arc' }) { $Backend = 'vulkan' }
  else { $Backend = 'cpu' }
}
if ($Model -eq 'auto') { $Model = if ($Backend -eq 'cuda' -and $vramMb -ge 10000) { 'nemo' } else { 'qwen7b' } }
$m = $Models[$Model]
Write-Host "Using the $Backend build of llama.cpp ($LlamaBuild) with $($m.name)."

# 2. llama.cpp
$llamaDir = Join-Path $dest 'llama'
$stamp = Join-Path $llamaDir 'build.txt'
if (-not (Test-Path $stamp) -or (Get-Content $stamp) -ne "$LlamaBuild $Backend") {
  if (Test-Path $llamaDir) { Remove-Item -Recurse -Force $llamaDir }
  New-Item -ItemType Directory -Force $llamaDir | Out-Null
  foreach ($b in $Builds[$Backend]) {
    $zip = Fetch "$LlamaBase/$($b.file)" $b.file $b.sha 'llama.cpp'
    & tar.exe -xf $zip -C $llamaDir
    if ($LASTEXITCODE) { throw "Could not extract $($b.file)" }
  }
  $server = Get-ChildItem $llamaDir -Recurse -Filter 'llama-server.exe' | Select-Object -First 1
  if (-not $server) { throw 'llama-server.exe was not found in the llama.cpp download.' }
  if ($server.DirectoryName -ne $llamaDir) { Get-ChildItem $server.DirectoryName | Move-Item -Destination $llamaDir -Force }
  Set-Content -Encoding ascii $stamp "$LlamaBuild $Backend"
}
Write-Host 'llama.cpp ready.'

# 3. Model
$modelDir = Join-Path $dest 'models'
New-Item -ItemType Directory -Force $modelDir | Out-Null
$modelPath = Join-Path $modelDir $m.file
if (-not (Test-Path $modelPath)) {
  $file = Fetch $m.url $m.file $m.sha "the model ($($m.name))"
  Move-Item $file $modelPath
}
# A newer pinned model replaces the old one: don't leave gigabytes of it behind.
Get-ChildItem $modelDir -Filter '*.gguf' | Where-Object { $_.Name -ne $m.file } | Remove-Item -Force
Write-Host 'Model ready.'

# 4. Settings read by the launcher.
$config = [ordered]@{
  model       = $m.name
  file        = $modelPath
  backend     = $Backend
  gpuLayers   = $(if ($Backend -eq 'cpu') { 0 } else { 99 })
  contextSize = 8192
  build       = $LlamaBuild
}
$config | ConvertTo-Json | Set-Content -Encoding ascii (Join-Path $dest 'ai-editor.json')

Remove-Item -Recurse -Force $dl -ErrorAction SilentlyContinue
Set-Content -Encoding ascii (Join-Path $dest 'installed-version.txt') $AddonVersion
Write-Host ''
Progress 'Done'
Write-Host "AI Editor installed in $dest ($($m.name), $Backend)."
Write-Host 'AuthorDesk picks it up straight away: open the AI Editor tab in the side panel.'
