param([string]$Python = "python", [int]$Port = 8000)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
if ($Python -eq "python") {
    if (Test-Path -LiteralPath ".venv/Scripts/python.exe") { $Python = Join-Path (Get-Location) ".venv/Scripts/python.exe" }
    elseif (Test-Path -LiteralPath "D:/Anaconda3/envs/yolo/python.exe") { $Python = "D:/Anaconda3/envs/yolo/python.exe" }
}
& $Python -c "import fastapi, uvicorn, httpx, jinja2"
if ($LASTEXITCODE -ne 0) { throw "Missing Web dependencies. Run: python -m pip install -r requirements-yolo.txt" }
Write-Host "Open http://127.0.0.1:$Port ; Ctrl+C to stop"
& $Python -m uvicorn src.web.main:app --host 127.0.0.1 --port $Port
exit $LASTEXITCODE
