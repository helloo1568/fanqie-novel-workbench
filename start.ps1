$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

if (-not (Test-Path -LiteralPath "node_modules")) {
  pnpm install
}

pnpm build
$env:PORT = "3210"
Start-Process "http://127.0.0.1:3210" | Out-Null
pnpm start
