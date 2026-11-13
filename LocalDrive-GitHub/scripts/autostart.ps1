param(
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'LocalDrive.lnk'
$startScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'start.bat'

if (-not (Test-Path $startScript)) {
  throw "LocalDrive start.bat was not found: $startScript"
}

if ($Remove) {
  if (Test-Path $shortcutPath) {
    Remove-Item -LiteralPath $shortcutPath -Force
    Write-Host 'LocalDrive autostart removed.'
  } else {
    Write-Host 'LocalDrive autostart was not installed.'
  }
  exit 0
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
$shortcut.Arguments = "/d /c `"`"$startScript`"`""
$shortcut.WorkingDirectory = Split-Path -Parent $startScript
$shortcut.Description = 'Start LocalDrive with gaming-aware mode'
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Host "LocalDrive autostart installed for the current Windows user."
Write-Host "Shortcut: $shortcutPath"
Write-Host 'Use autostart.bat /remove to uninstall it.'
