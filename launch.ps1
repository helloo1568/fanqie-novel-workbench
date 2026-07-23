$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://127.0.0.1:3210"
Set-Location -LiteralPath $root
New-Item -ItemType Directory -Force -Path (Join-Path $root ".data") | Out-Null

function Test-Workbench {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$url/api/health" -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (Test-Workbench) {
  Start-Process $url | Out-Null
  exit 0
}

if (-not (Test-Path -LiteralPath "node_modules")) {
  $install = Start-Process -FilePath "pnpm.cmd" `
    -ArgumentList "install" `
    -WorkingDirectory $root `
    -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput (Join-Path $root ".data\install.log") `
    -RedirectStandardError (Join-Path $root ".data\install-error.log")
  if ($install.ExitCode -ne 0) {
    throw "依赖安装失败，请查看 .data\install-error.log"
  }
}

$build = Start-Process -FilePath "pnpm.cmd" `
  -ArgumentList "build" `
  -WorkingDirectory $root `
  -Wait -PassThru -NoNewWindow `
  -RedirectStandardOutput (Join-Path $root ".data\build.log") `
  -RedirectStandardError (Join-Path $root ".data\build-error.log")
if ($build.ExitCode -ne 0) {
  throw "构建失败，请查看 .data\build-error.log"
}

$env:PORT = "3210"
$stdout = Join-Path $root ".data\server.log"
$stderr = Join-Path $root ".data\server-error.log"
Start-Process -FilePath (Get-Command node.exe).Source `
  -ArgumentList "dist-server/server/index.js" `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr | Out-Null

for ($attempt = 0; $attempt -lt 40; $attempt++) {
  Start-Sleep -Milliseconds 250
  if (Test-Workbench) {
    Start-Process $url | Out-Null
    exit 0
  }
}

throw "工作台启动超时，请查看 .data\server-error.log"
