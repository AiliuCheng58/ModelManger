param(
    [string]$NodePath = 'node',
    [switch]$Development
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath 'node_modules/tsx')) {
    throw '请先在项目目录执行 pnpm install 安装依赖。'
}

if ($Development) {
    & $NodePath --import tsx server/index.ts
    exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath 'dist/index.html')) {
    & $NodePath node_modules/typescript/bin/tsc --noEmit
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $NodePath node_modules/vite/bin/vite.js build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

& $NodePath --import tsx server/index.ts --production
exit $LASTEXITCODE
