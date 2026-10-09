# 启动本项目Web服务并记录所属进程身份。
param([string]$Python = "python", [ValidateRange(1024,65535)][int]$Port = 8000, [switch]$Background)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
$startRoot = (Get-Location).Path
. (Join-Path $PSScriptRoot "stop.ps1") -FunctionsOnly
if ($Python -eq "python") {
    if (Test-Path -LiteralPath ".venv/Scripts/python.exe") { $Python = Join-Path (Get-Location) ".venv/Scripts/python.exe" }
    elseif (Test-Path -LiteralPath "D:/Anaconda3/envs/yolo/python.exe") { $Python = "D:/Anaconda3/envs/yolo/python.exe" }
}
$Python = (Get-Command $Python -ErrorAction Stop).Source
$existing = Get-AIUWebServerState $startRoot
if ($existing.Processes.Count -gt 0) {
    Write-Host "Owned web server is already running on port $($existing.Record.port)."
    Write-Host "Interview showcase: http://127.0.0.1:$($existing.Record.port)/showcase"
    Write-Host "Research workspace: http://127.0.0.1:$($existing.Record.port)/research"
    exit 0
}
$portOwners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if ($portOwners.Count -gt 0) { throw "Port $Port is already in use. No process was stopped. Choose another port or stop that service yourself." }
& $Python -c "import fastapi, uvicorn, httpx, jinja2"
if ($LASTEXITCODE -ne 0) { throw "Missing Web dependencies. Run: python -m pip install -r requirements-yolo.txt" }
Write-Host "Interview showcase: http://127.0.0.1:$Port/showcase"
Write-Host "Research workspace: http://127.0.0.1:$Port/research"
if ($Background) {
    $logDirectory = Join-Path $startRoot "logs"
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $serverProcess = Start-Process -FilePath $Python -ArgumentList @("-X", "utf8", "-m", "uvicorn", "src.web.main:app", "--host", "127.0.0.1", "--port", "$Port", "--app-dir", ('"' + $startRoot + '"')) -WorkingDirectory $startRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory "web-stdout.log") -RedirectStandardError (Join-Path $logDirectory "web-stderr.log")
    $ownership = @{pid=$serverProcess.Id; port=$Port; started_at=$serverProcess.StartTime.ToString("o"); python=$Python; workspace=$startRoot; processes=@()}
    $recordPath = Join-Path $logDirectory "web-server.json"
    $ownership | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $recordPath -Encoding UTF8
    $startupDeadline = [DateTime]::UtcNow.AddSeconds(30)
    $listener = @()
    do {
        $state = Get-AIUWebServerState $startRoot
        if ($state.Processes.Count -eq 0) { throw "Web server exited during startup. Read logs/web-stderr.log." }
        $listener = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
        if ($listener.Count -gt 0 -and @($listener | Where-Object { $state.Processes.ProcessId -notcontains $_.OwningProcess }).Count -gt 0) { throw "Another process acquired port $Port; its process will not be stopped." }
        if ($listener.Count -eq 0) { Start-Sleep -Milliseconds 250 }
    } while ($listener.Count -eq 0 -and [DateTime]::UtcNow -lt $startupDeadline)
    $ownership.processes = @($state.Processes | ForEach-Object { @{pid=$_.ProcessId; started_at=$_.CreationDate.ToString("o")} })
    $ownership | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $recordPath -Encoding UTF8
    if ($listener.Count -eq 0) { throw "Web server has not opened port $Port after 30 seconds; ownership record retained. Read logs/web-stderr.log." }
    Write-Host "Background server PID: $($serverProcess.Id). Logs: logs/web-stderr.log"
    exit 0
}
Write-Host "Ctrl+C to stop"
& $Python -m uvicorn src.web.main:app --host 127.0.0.1 --port $Port --app-dir $startRoot
exit $LASTEXITCODE
