param(
  [int]$BackendPort = 4188,
  [int]$FrontendPort = 4173,
  [switch]$Offline,
  [switch]$Rules,
  [switch]$Automatic,
  [switch]$NoAutomatic
)
$ErrorActionPreference = 'Stop'
$runtime = (Get-Command node -ErrorAction SilentlyContinue).Source
if (!$runtime) { throw '请安装 Node.js 24.14.0 或更新版本，并确保 node 已加入 PATH。' }
$arguments = @((Join-Path $PSScriptRoot 'start.mjs'), '--backend-port', $BackendPort.ToString(), '--frontend-port', $FrontendPort.ToString())
if ($Offline) { $arguments += '--offline' }
if ($Rules) { $arguments += '--rules' }
if ($Automatic) { $arguments += '--automatic' }
if ($NoAutomatic) { $arguments += '--no-automatic' }
& $runtime @arguments
exit $LASTEXITCODE
