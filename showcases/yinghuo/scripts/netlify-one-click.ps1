# Netlify one-click deploy. Run: powershell -ExecutionPolicy Bypass -File .\scripts\netlify-one-click.ps1
# (UTF-8 with BOM - required for Windows PowerShell 5.x + Chinese path)

$ErrorActionPreference = "Stop"

if (-not $PSScriptRoot) {
  throw "Use: powershell -ExecutionPolicy Bypass -File .\scripts\netlify-one-click.ps1"
}
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $root

if (-not (Test-Path (Join-Path $root "node_modules"))) {
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
}

# Not logged in -> netlify status fails (CLI has "status", not "whoami")
$null = npx netlify status 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "Opening browser for Netlify login..." -ForegroundColor Yellow
  npx netlify login
  if ($LASTEXITCODE -ne 0) { throw "Netlify login failed" }
}

# First time: no linked site
$statePath = Join-Path (Join-Path $root ".netlify") "state.json"
if (-not (Test-Path -LiteralPath $statePath)) {
  Write-Host "First deploy: follow prompts to create or link a Netlify site." -ForegroundColor Yellow
  npx netlify init
  if ($LASTEXITCODE -ne 0) { throw "netlify init failed" }
}

npm run deploy:netlify
if ($LASTEXITCODE -ne 0) { throw "deploy failed" }

Write-Host "Done. Set VITE_DASHSCOPE_* in Netlify env and redeploy if AI key needed." -ForegroundColor Cyan
