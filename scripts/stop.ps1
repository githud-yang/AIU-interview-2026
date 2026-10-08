param([switch]$FunctionsOnly, [switch]$WhatIf)
$ErrorActionPreference = "Stop"

function Test-AIUWebProcess {
    param($Process, [string]$Workspace, [int]$ServerPort, [switch]$LegacyRoot)
    if (-not $Process -or -not $Process.CommandLine -or -not $Process.ExecutablePath) { return $false }
    if ((Split-Path $Process.ExecutablePath -Leaf) -notin @("python.exe", "pythonw.exe")) { return $false }
    $arguments = @([regex]::Matches($Process.CommandLine, '(?:[^\s"]+|"[^"]*")+') | ForEach-Object { $_.Value.Trim('"') })
    $moduleIndex = [Array]::IndexOf($arguments, "-m")
    $portIndex = [Array]::IndexOf($arguments, "--port")
    $hostIndex = [Array]::IndexOf($arguments, "--host")
    if ($moduleIndex -lt 0 -or $moduleIndex + 2 -ge $arguments.Count -or $arguments[$moduleIndex + 1] -ne "uvicorn" -or $arguments[$moduleIndex + 2] -ne "src.web.main:app") { return $false }
    if ($portIndex -lt 0 -or $portIndex + 1 -ge $arguments.Count -or $arguments[$portIndex + 1] -ne "$ServerPort") { return $false }
    if ($hostIndex -lt 0 -or $hostIndex + 1 -ge $arguments.Count -or $arguments[$hostIndex + 1] -ne "127.0.0.1") { return $false }
    $appIndex = [Array]::IndexOf($arguments, "--app-dir")
    if ($appIndex -ge 0 -and $appIndex + 1 -lt $arguments.Count) {
        try { return [IO.Path]::GetFullPath($arguments[$appIndex + 1]).TrimEnd('\') -ieq $Workspace.TrimEnd('\') } catch { return $false }
    }
    # Records created before --app-dir was added used the project's venv launcher.
    return $LegacyRoot -and [IO.Path]::GetFullPath($Process.ExecutablePath).StartsWith(($Workspace.TrimEnd('\') + '\.venv\'), [StringComparison]::OrdinalIgnoreCase)
}

function Test-AIUProcessStart {
    param($Process, $RecordedStart)
    if (-not $Process -or -not $RecordedStart) { return $false }
    try {
        $expected = if ($RecordedStart -is [DateTime]) { $RecordedStart.ToUniversalTime() } elseif ($RecordedStart -is [DateTimeOffset]) { $RecordedStart.UtcDateTime } else { [DateTimeOffset]::Parse($RecordedStart).UtcDateTime }
        return [Math]::Abs(($Process.CreationDate.ToUniversalTime() - $expected).TotalMilliseconds) -le 10
    } catch { return $false }
}

function Get-AIUWebServerState {
    param([string]$Workspace)
    $recordPath = Join-Path $Workspace "logs/web-server.json"
    if (-not (Test-Path -LiteralPath $recordPath)) { return [pscustomobject]@{Record=$null; Processes=@(); Path=$recordPath} }
    $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    if ($record.port -lt 1024 -or $record.port -gt 65535 -or $record.pid -le 0) { throw "Invalid server ownership record: $recordPath" }
    if ($record.workspace -and [IO.Path]::GetFullPath($record.workspace).TrimEnd('\') -ine $Workspace.TrimEnd('\')) { throw "Server record belongs to a different workspace." }
    $rootProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.pid)"
    $verified = @()
    if ($rootProcess) {
        if (-not (Test-AIUProcessStart $rootProcess $record.started_at) -or -not (Test-AIUWebProcess $rootProcess $Workspace $record.port -LegacyRoot) -or $rootProcess.ExecutablePath -ine $record.python) {
            throw "Recorded PID no longer matches the owned web server; no process will be stopped."
        }
        $verified += $rootProcess
        $frontier = @($rootProcess)
        while ($frontier.Count -gt 0) {
            $next = @()
            foreach ($ancestor in $frontier) {
                $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($ancestor.ProcessId)")
                foreach ($child in $children) {
                    if ($child.CreationDate -ge $ancestor.CreationDate -and (Test-AIUWebProcess $child $Workspace $record.port)) { $verified += $child; $next += $child }
                    elseif (-not $record.workspace -and $child.CreationDate -ge $ancestor.CreationDate) {
                        # The old venv launcher delegates to its base Python executable.
                        $synthetic = [pscustomobject]@{CommandLine=$child.CommandLine; ExecutablePath=$rootProcess.ExecutablePath}
                        if ((Split-Path $child.ExecutablePath -Leaf) -in @("python.exe", "pythonw.exe") -and (Test-AIUWebProcess $synthetic $Workspace $record.port -LegacyRoot)) { $verified += $child; $next += $child }
                    }
                }
            }
            $frontier = $next
        }
    }
    # New records retain child identity in case the launcher exits first.
    foreach ($identity in @($record.processes)) {
        if (-not $identity -or $verified.ProcessId -contains [uint32]$identity.pid) { continue }
        $known = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$identity.pid)"
        if ($known) {
            if (-not (Test-AIUProcessStart $known $identity.started_at) -or -not (Test-AIUWebProcess $known $Workspace $record.port)) { throw "A recorded child PID has changed identity; no process will be stopped." }
            $verified += $known
        }
    }
    return [pscustomobject]@{Record=$record; Processes=@($verified); Path=$recordPath}
}

function Stop-AIUWebServer {
    param([string]$Workspace, [switch]$Preview)
    $state = Get-AIUWebServerState $Workspace
    if (-not $state.Record) { Write-Host "No background server ownership record exists."; return }
    foreach ($owned in @($state.Processes | Sort-Object CreationDate -Descending)) {
        $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($owned.ProcessId)"
        if (-not $current) { continue }
        if (-not (Test-AIUProcessStart $current $owned.CreationDate.ToString("o")) -or $current.CommandLine -cne $owned.CommandLine -or $current.ExecutablePath -ine $owned.ExecutablePath) { throw "Server process identity changed during stop; operation aborted." }
        if ($Preview) { Write-Host "Verified owned server PID: $($current.ProcessId)" }
        else { Stop-Process -Id $current.ProcessId -ErrorAction Stop; Write-Host "Stopped owned server PID: $($current.ProcessId)" }
    }
    if (-not $Preview) {
        $remaining = @(Get-AIUWebServerState $Workspace).Processes
        if ($remaining.Count -gt 0) { throw "Owned web server is still stopping; ownership record preserved." }
        Remove-Item -LiteralPath $state.Path
        Write-Host "Background server ownership record cleared."
    }
}

if (-not $FunctionsOnly) {
    $stopWorkspace = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
    Stop-AIUWebServer -Workspace $stopWorkspace -Preview:$WhatIf
}
