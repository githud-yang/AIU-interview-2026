param([string]$Python = "python")
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
& $Python -m uvicorn src.web.main:app --host 127.0.0.1 --port 8000
