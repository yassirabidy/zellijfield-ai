# Zellijfield AI engine manager (Windows side; started in the background by start.bat).
#
# Installs, starts, stops and deletes the Wan2GP and ComfyUI engines for the dashboard without
# giving any container access to Docker (the Docker socket is never mounted). The studio and this
# script talk through files in <data>/engines:
#   requests/<id>.json   written by the studio: {"engine": "wan2gp", "action": "install"}
#                        ("action": "cancel" stops the engine's running operation)
#   status.json          written here every few seconds: images, containers, running operations
#   op-<engine>.json     progress of the current operation (written by its background job)
# Only the fixed engines and actions below are accepted, and every Docker call uses a fixed
# argument list (no command strings are ever built from request data).
# Windows PowerShell 5.1 compatible.

param(
    [string]$ProjectDir = (Split-Path -Parent $PSScriptRoot),
    [string]$ProjectName = 'zellijfield-ai',
    [string]$ImagePrefix = 'zellijfield-ai',
    # Extra compose files (tests only). Empty: compose uses COMPOSE_FILE from .env.
    [string[]]$ComposeFiles = @(),
    [int]$PollMs = 1000,
    # Stop a running manager (stop.bat) instead of starting one.
    [switch]$Stop
)

# Native commands report through exit codes, which the script checks itself; 'Stop' would turn
# Docker's stderr into exceptions in Windows PowerShell 5.1.
$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath $ProjectDir

$Engines = @('wan2gp', 'comfyui')
$Actions = @('install', 'start', 'stop', 'delete')

function Read-DotEnv([string]$Path) {
    $values = @{}
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in Get-Content -LiteralPath $Path) {
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') { $values[$Matches[1]] = $Matches[2] }
        }
    }
    return $values
}

$dotEnv = Read-DotEnv (Join-Path $ProjectDir '.env')
$dataDir = if ($dotEnv['ZF_DATA_DIR']) { $dotEnv['ZF_DATA_DIR'] } else { './data' }
if (-not [System.IO.Path]::IsPathRooted($dataDir)) { $dataDir = Join-Path $ProjectDir $dataDir }
$tag = if ($dotEnv['ZF_IMAGE_TAG']) { $dotEnv['ZF_IMAGE_TAG'] } else { 'local' }
$root = Join-Path $dataDir 'engines'
$requestsDir = Join-Path $root 'requests'
New-Item -ItemType Directory -Force -Path $requestsDir | Out-Null

# One manager per project.
$pidFile = Join-Path $root 'manager.pid'
if ($Stop) {
    $old = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($old) { Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'powershell|pwsh' } | Stop-Process -Force }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'Engine manager stopped.'
    exit 0
}
if (Test-Path -LiteralPath $pidFile) {
    $old = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($old -and $old -ne "$PID" -and (Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'powershell|pwsh' })) {
        Write-Host "Engine manager already running (PID $old)."
        exit 0
    }
}
Set-Content -LiteralPath $pidFile -Value $PID

function Write-JsonFile([string]$Path, $Value) {
    $tmp = "$Path.tmp"
    [System.IO.File]::WriteAllText($tmp, ($Value | ConvertTo-Json -Depth 6 -Compress))
    Move-Item -LiteralPath $tmp -Destination $Path -Force
}

function Get-ComposeArgs([string]$Engine) {
    $list = @('compose', '-p', $ProjectName)
    foreach ($file in $ComposeFiles) { $list += @('-f', $file) }
    return $list + @('--profile', $Engine)
}

# Fixed Docker steps per action. Each step is an argument list for `docker`.
function Get-Steps([string]$Engine, [string]$Action) {
    $compose = Get-ComposeArgs $Engine
    switch ($Action) {
        'install' { return , @(($compose + @('--progress', 'plain', 'build', $Engine)), ($compose + @('up', '-d', '--no-build', $Engine))) }
        'start'   { return , @(, ($compose + @('up', '-d', '--no-build', $Engine))) }
        'stop'    { return , @(, ($compose + @('stop', $Engine))) }
        'delete'  { return , @(($compose + @('rm', '-s', '-f', $Engine)), @('image', 'rm', "$ImagePrefix/${Engine}:$tag")) }
    }
}

# Runs one operation in a background job and reports progress to op-<engine>.json.
$opJob = {
    param($ProjectDir, $OpFile, $Engine, $Action, $Steps)
    Set-Location -LiteralPath $ProjectDir
    # Docker writes UTF-8; without this, Windows PowerShell decodes it with the OEM code page.
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
    function Save($state) {
        $tmp = "$OpFile.tmp"
        [System.IO.File]::WriteAllText($tmp, ($state | ConvertTo-Json -Depth 4 -Compress))
        Move-Item -LiteralPath $tmp -Destination $OpFile -Force
    }
    # pid: this job's process, so the manager can cancel it (Stop-Operation).
    $state = [ordered]@{ engine = $Engine; action = $Action; status = 'running'; progress = 0; message = 'Starting'; error = $null
        startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); finishedAt = $null; pid = $PID }
    Save $state
    $tail = New-Object System.Collections.Generic.List[string]
    $lastSave = Get-Date
    for ($i = 0; $i -lt $Steps.Count; $i++) {
        $stepArgs = $Steps[$i]
        & docker @stepArgs 2>&1 | ForEach-Object {
            $line = "$_".Trim()
            if (-not $line) { return }
            $tail.Add($line)
            if ($tail.Count -gt 20) { $tail.RemoveAt(0) }
            # BuildKit plain progress: "#12 [wan2gp 7/15] RUN ..." or "#12 [ 7/15] RUN ..." (the step
            # number is padded to the width of the total) gives the build step.
            $fraction = $null
            if ($line -match '\[(?:[^\s\]]+\s+)?\s*(\d+)/(\d+)\]') { $fraction = [double]$Matches[1] / [double]$Matches[2] }
            $base = $i / $Steps.Count
            if ($null -ne $fraction) { $state.progress = [math]::Round($base + $fraction / $Steps.Count, 3) }
            $state.message = if ($line.Length -gt 200) { $line.Substring(0, 200) } else { $line }
            if (((Get-Date) - $lastSave).TotalMilliseconds -ge 500) { Save $state; $lastSave = Get-Date }
        }
        if ($LASTEXITCODE -ne 0) {
            # Deleting something that is already gone is fine.
            if ($Action -eq 'delete' -and ($tail -join "`n") -match 'No such image|No such container|no container') { continue }
            $state.status = 'failed'
            $state.error = ($tail | Select-Object -Last 6) -join "`n"
            $state.finishedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            Save $state
            return
        }
        $state.progress = [math]::Round(($i + 1) / $Steps.Count, 3)
        Save $state
    }
    $state.status = 'succeeded'
    $state.progress = 1
    $state.message = 'Done'
    $state.finishedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    Save $state
}

function ConvertFrom-DockerSize([string]$Text) {
    if ($Text -match '^([\d.]+)\s*([kKMGT]?B)$') {
        $factor = @{ 'B' = 1; 'KB' = 1e3; 'MB' = 1e6; 'GB' = 1e9; 'TB' = 1e12 }[$Matches[2].ToUpper()]
        return [int64]([double]$Matches[1] * $factor)
    }
    return $null
}

function Get-DockerState {
    $state = @{ dockerOk = $false; images = @{}; containers = @{} }
    $lines = & docker image ls --format '{{.Repository}}:{{.Tag}}|{{.Size}}' 2>$null
    if ($LASTEXITCODE -ne 0) { return $state }
    $state.dockerOk = $true
    foreach ($line in $lines) {
        $parts = "$line".Split('|')
        if ($parts.Count -eq 2) { $state.images[$parts[0]] = $parts[1] }
    }
    foreach ($engine in $Engines) {
        $info = & docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$ProjectName-$engine-1" 2>$null
        if ($LASTEXITCODE -eq 0 -and $info) {
            $parts = "$info".Split('|')
            $state.containers[$engine] = @{ status = $parts[0]; health = $parts[1] }
        }
    }
    return $state
}

$jobs = @{}

# Kills a process and everything it started (the job's docker, compose and buildx processes).
function Stop-ProcessTree([int]$Id) {
    foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $Id" -ErrorAction SilentlyContinue)) {
        Stop-ProcessTree ([int]$child.ProcessId)
    }
    Stop-Process -Id $Id -Force -ErrorAction SilentlyContinue
}

# Cancels an engine's running operation. Killing the job's Docker client makes BuildKit stop the
# build; layers already downloaded or built stay cached, so the next install continues from there.
function Stop-Operation([string]$Engine) {
    $opFile = Join-Path $root "op-$Engine.json"
    $op = $null
    try { $op = Get-Content -LiteralPath $opFile -Raw | ConvertFrom-Json } catch { $op = $null }
    if ($op -and $op.pid) {
        $proc = Get-Process -Id ([int]$op.pid) -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'powershell|pwsh' }
        if ($proc) { Stop-ProcessTree $proc.Id }
    }
    Stop-Job -Job $jobs[$Engine] -ErrorAction SilentlyContinue
    Remove-Job -Job $jobs[$Engine] -Force -ErrorAction SilentlyContinue
    $jobs.Remove($Engine)
    if ($op) {
        $op.status = 'cancelled'
        $op.message = 'Cancelled'
        $op.finishedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        Write-JsonFile $opFile $op
    }
}

$docker = Get-DockerState
$cycle = 0
Write-Host "Zellijfield AI engine manager running (PID $PID). Watching $requestsDir"

while ($true) {
    # New requests from the studio.
    foreach ($file in Get-ChildItem -LiteralPath $requestsDir -Filter '*.json' -File -ErrorAction SilentlyContinue) {
        $request = $null
        try {
            if ($file.Length -le 4096) { $request = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json }
        } catch { $request = $null }
        Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
        if (-not $request) { continue }
        $engine = "$($request.engine)"
        $action = "$($request.action)"
        if ($Engines -notcontains $engine) { continue }
        if ($action -eq 'cancel') {
            if ($jobs.ContainsKey($engine)) {
                Stop-Operation $engine
                $cycle = 0  # refresh Docker state right away
                Write-Host "$(Get-Date -Format s) cancel $engine"
            }
            continue
        }
        if ($Actions -notcontains $action) { continue }
        if ($jobs.ContainsKey($engine)) { continue }
        $opFile = Join-Path $root "op-$engine.json"
        $steps = Get-Steps $engine $action
        $jobs[$engine] = Start-Job -ScriptBlock $opJob -ArgumentList $ProjectDir, $opFile, $engine, $action, $steps
        Write-Host "$(Get-Date -Format s) $action $engine"
    }

    # Finished operations.
    foreach ($engine in @($jobs.Keys)) {
        if ($jobs[$engine].State -ne 'Running') {
            Receive-Job -Job $jobs[$engine] -ErrorAction SilentlyContinue | Out-Null
            Remove-Job -Job $jobs[$engine] -Force
            $jobs.Remove($engine)
            $cycle = 0  # refresh Docker state right away
        }
    }

    if ($cycle % 3 -eq 0) { $docker = Get-DockerState }
    $cycle++

    $status = [ordered]@{ updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); dockerOk = $docker.dockerOk; engines = [ordered]@{} }
    foreach ($engine in $Engines) {
        $image = "$ImagePrefix/${engine}:$tag"
        $opFile = Join-Path $root "op-$engine.json"
        $op = $null
        if (Test-Path -LiteralPath $opFile) { try { $op = Get-Content -LiteralPath $opFile -Raw | ConvertFrom-Json } catch { $op = $null } }
        $container = $docker.containers[$engine]
        $status.engines[$engine] = [ordered]@{
            installed = $docker.images.ContainsKey($image)
            sizeLabel = $docker.images[$image]
            sizeBytes = if ($docker.images.ContainsKey($image)) { ConvertFrom-DockerSize $docker.images[$image] } else { $null }
            container = if ($container) { $container.status } else { 'none' }
            health = if ($container) { $container.health } else { '' }
            busy = $jobs.ContainsKey($engine)
            op = $op
        }
    }
    Write-JsonFile (Join-Path $root 'status.json') $status
    Start-Sleep -Milliseconds $PollMs
}
