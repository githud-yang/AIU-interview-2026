# No browser flow after you set one token. Usage:
#   $env:NETLIFY_AUTH_TOKEN = "从 Netlify 复制"
#   npm run deploy:token
# Token: https://app.netlify.com/user/applications#personal-access-tokens

$ErrorActionPreference = "Stop"

if (-not $PSScriptRoot) {
  throw "Run: npm run deploy:token"
}
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $root

if ([string]::IsNullOrWhiteSpace($env:NETLIFY_AUTH_TOKEN)) {
  Write-Host ""
  Write-Host "需要 NETLIFY_AUTH_TOKEN（只需配置一次，可放进系统环境变量）。" -ForegroundColor Yellow
  Write-Host "1) 打开: https://app.netlify.com/user/applications#personal-access-tokens" -ForegroundColor Cyan
  Write-Host "2) New access token - 起个名 - 创建 - 全选复制" -ForegroundColor Cyan
  Write-Host "3) 在本窗口执行（把 paste 换成你的 token）：" -ForegroundColor Cyan
  Write-Host '   $env:NETLIFY_AUTH_TOKEN = "paste"' -ForegroundColor White
  Write-Host "4) 再执行: npm run deploy:token" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "多团队时可选: `$env:NETLIFY_ACCOUNT_SLUG = '你的-team-slug'" -ForegroundColor DarkGray
  exit 1
}

if (-not (Test-Path (Join-Path $root "node_modules"))) {
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
}

$statePath = Join-Path (Join-Path $root ".netlify") "state.json"
if (-not (Test-Path -LiteralPath $statePath)) {
  $siteName = "yinghuo-" + [Guid]::NewGuid().ToString("N").Substring(0, 12)
  Write-Host "Creating Netlify site: $siteName ..." -ForegroundColor Yellow
  if (-not [string]::IsNullOrWhiteSpace($env:NETLIFY_ACCOUNT_SLUG)) {
    npx netlify sites:create --name $siteName --account-slug $env:NETLIFY_ACCOUNT_SLUG
  } else {
    npx netlify sites:create --name $siteName
  }
  if ($LASTEXITCODE -ne 0) { throw "netlify sites:create failed" }
}

Write-Host "Building ..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

Write-Host "Deploying to production ..." -ForegroundColor Yellow
npx netlify deploy --prod --dir=dist
if ($LASTEXITCODE -ne 0) { throw "netlify deploy failed" }

Write-Host ""
Write-Host "完成。看上面 Production / Live URL。通义 Key 请在 Netlify 后台 Environment variables 配置后 Trigger deploy。" -ForegroundColor Green
