param(
  [string[]]$GameProcessNames = @('cs2', 'dota2'),
  [int]$PollSeconds = 5
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = Join-Path $root '.tools\node24\node-v24.22.3-win-x64\node.exe'
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction Stop).Source }
$serverEntry = Join-Path $root 'dist-server\index.js'
if (-not (Test-Path $serverEntry)) { throw 'dist-server/index.js is missing. Run npm run build first.' }

function Test-GameRunning {
  foreach ($name in $GameProcessNames) {
    if (Get-Process -Name $name -ErrorAction SilentlyContinue) { return $true }
  }
  return $false
}

function Start-LocalDrive {
  Write-Host 'Starting LocalDrive.'
  return Start-Process -FilePath $node -ArgumentList $serverEntry -WorkingDirectory $root -PassThru -WindowStyle Hidden
}

$server = $null
$wasGaming = $false
try {
  while ($true) {
    $gaming = Test-GameRunning
    if ($gaming -and -not $wasGaming) {
      Write-Host 'Game detected. LocalDrive will be paused.'
      if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
      $server = $null
    } elseif (-not $gaming -and $wasGaming) {
      Write-Host 'Game closed. LocalDrive will resume.'
    }
    if (-not $gaming -and (-not $server -or $server.HasExited)) { $server = Start-LocalDrive }
    $wasGaming = $gaming
    Start-Sleep -Seconds $PollSeconds
  }
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
