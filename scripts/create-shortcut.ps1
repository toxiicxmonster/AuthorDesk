# Creates (or refreshes) an "AuthorDesk" shortcut on the desktop pointing at AuthorDesk.exe.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'AuthorDesk.exe'
if (-not (Test-Path $exe)) { throw 'AuthorDesk.exe not found. Run scripts\build.ps1 first.' }
$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop 'AuthorDesk.lnk'
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($link)
$s.TargetPath = $exe
$s.WorkingDirectory = $root
$s.IconLocation = "$exe,0"
$s.Description = 'AuthorDesk - writing studio'
$s.Save()
Write-Host "Shortcut created: $link"
