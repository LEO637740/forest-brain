$ErrorActionPreference = 'Stop'
$fusionRoot = $PSScriptRoot
$fusionCommand = Get-Command node -ErrorAction SilentlyContinue
$fusionNode = if ($fusionCommand) { $fusionCommand.Source } else { $null }
if (!$fusionNode) {
    $fusionBundled = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if (Test-Path -LiteralPath $fusionBundled) { $fusionNode = $fusionBundled }
}
if (!$fusionNode) { throw '未找到 Node.js，请安装 Node.js 24.14.0 或以上版本并加入 PATH。' }
Push-Location -LiteralPath $fusionRoot
try {
    & $fusionNode 'start-fusion.mjs' @args
    $fusionExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $fusionExitCode
