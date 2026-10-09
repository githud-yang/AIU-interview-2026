# 将独立萤火项目的可运行源码同步为二面展示快照，排除密钥、用户数据与构建产物。
param([string]$Source = 'D:\03_项目与代码\创作项目\荧火')
$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceRoot = [IO.Path]::GetFullPath($Source).TrimEnd('\')
$exportRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot 'showcases\yinghuo'))
$exportPrefix = $exportRoot + [IO.Path]::DirectorySeparatorChar
if (-not $exportRoot.StartsWith($workspaceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '展示目录不在当前仓库内。' }
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'package.json'))) { throw '来源不是萤火项目。' }
if ($sourceRoot.Equals($exportRoot, [StringComparison]::OrdinalIgnoreCase)) { throw '来源不能与展示快照相同。' }
if (Test-Path -LiteralPath $exportRoot) {
  $existingLinks = @(Get-ChildItem -LiteralPath $exportRoot -Force -Recurse | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
  if ((Get-Item -LiteralPath $exportRoot).Attributes -band [IO.FileAttributes]::ReparsePoint -or $existingLinks.Count) { throw '展示目录内存在链接，请先检查。' }
}
New-Item -ItemType Directory -Path $exportRoot -Force | Out-Null
@'
# Preserve source bytes and recognise original Windows line endings.
* -text whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol
# Markdown hard line breaks deliberately use trailing spaces.
*.md whitespace=-blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol
'@ | Set-Content -LiteralPath (Join-Path $exportRoot '.gitattributes') -Encoding utf8
$relativeFiles = [Collections.Generic.List[string]]::new()
foreach ($name in @('README.md','NOTICE','.env.example','.gitignore','package.json','package-lock.json','index.html','vite.config.ts','eslint.config.js','tsconfig.json','tsconfig.app.json','tsconfig.node.json','DEPLOY_NETLIFY.md','DEPLOY_VERCEL.md')) { $relativeFiles.Add($name) }
foreach ($folder in @('src','server','scripts','tests','public')) {
  $folderPath = Join-Path $sourceRoot $folder
  foreach ($file in (Get-ChildItem -LiteralPath $folderPath -Recurse -File -Force)) {
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '来源文件中有链接，请先检查。' }
    $relativeFiles.Add($file.FullName.Substring($sourceRoot.Length + 1))
  }
}
foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'docs') -File -Filter '*.md')) { $relativeFiles.Add('docs\' + $file.Name) }
foreach ($name in @('tools\gaokao3500\README.md')) { $relativeFiles.Add($name) }
$previousManifest = Join-Path $exportRoot 'source-manifest.json'
if (Test-Path -LiteralPath $previousManifest) {
  $previous = Get-Content -LiteralPath $previousManifest -Raw | ConvertFrom-Json
  foreach ($entry in $previous.files) {
    if (-not $relativeFiles.Contains($entry.path.Replace('/', '\'))) {
      $obsoletePath = [IO.Path]::GetFullPath((Join-Path $exportRoot $entry.path))
      if (-not $obsoletePath.StartsWith($exportPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw '旧清单路径超出展示目录。' }
      if (Test-Path -LiteralPath $obsoletePath -PathType Leaf) { Remove-Item -LiteralPath $obsoletePath }
    }
  }
}
$manifestFiles = foreach ($relative in ($relativeFiles | Sort-Object -Unique)) {
  if ($relative -match '(^|[\\/])(node_modules|dist|\.local|\.git)([\\/]|$)' -or ($relative -match '(^|[\\/])\.env' -and $relative -ne '.env.example')) { throw '来源清单包含私有或运行文件。' }
  $destination = [IO.Path]::GetFullPath((Join-Path $exportRoot $relative))
  if (-not $destination.StartsWith($exportPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw '目标路径超出展示目录。' }
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceRoot $relative) -Destination $destination -Force
  [PSCustomObject]@{path=$relative.Replace('\','/');sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()}
}
@{name='萤火二面源码快照';source=$sourceRoot;exportedAt=(Get-Date).ToString('o');files=@($manifestFiles)} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $previousManifest -Encoding utf8
Write-Output "已同步 $($manifestFiles.Count) 个源码/说明文件到 $exportRoot"
