# Lumina Feed · Windows 快速启动（双击或 PowerShell 运行）
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "  Lumina Feed · 快速启动" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "  ✗ 未找到 Node.js，请先安装 Node ≥ 22.18" -ForegroundColor Red
  Read-Host "按 Enter 退出"
  exit 1
}

$arg = $args -join " "
if ($arg) {
  node tools/quickstart.mjs @args
} else {
  node tools/quickstart.mjs
}

$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host ""
  Write-Host "  退出码: $code" -ForegroundColor Yellow
}
Read-Host "`n按 Enter 关闭"
exit $code
