# Zellijfield AI preflight for Windows - checks Docker, GPU access, disk space, ports and model folders.
# Usage: preflight.bat [mock|wan2gp|comfyui|full]     (default: mock)
param(
    [ValidateSet('mock', 'wan2gp', 'comfyui', 'full')]
    [string]$StackProfile = 'mock'
)

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)

$CudaTestImage = 'nvidia/cuda:12.8.1-base-ubuntu22.04'
$script:Fails = 0
function Ok($msg)   { Write-Host "  [ OK ] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red; $script:Fails++ }

# Read KEY=value from .env without executing it.
function Get-EnvValue($key, $default) {
    if (Test-Path .env) {
        $line = Get-Content .env | Where-Object { $_ -match "^$key=" } | Select-Object -Last 1
        if ($line) { return ($line -replace "^$key=", '').Trim() }
    }
    return $default
}

function Exit-Preflight {
    Write-Host ''
    if ($script:Fails -gt 0) {
        Write-Host "Preflight failed with $($script:Fails) problem(s). Fix the [FAIL] items above and run it again." -ForegroundColor Red
        exit 1
    }
    Write-Host 'Preflight passed.' -ForegroundColor Green
    exit 0
}

Write-Host "Zellijfield AI preflight (profile: $StackProfile)"

# -- Docker -----------------------------------------------------------------------
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail 'Docker is not installed. Install Docker Desktop for Windows (WSL2 backend): https://docs.docker.com/desktop/setup/install/windows-install/'
    Exit-Preflight
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Fail "Docker is installed but not running. Start Docker Desktop and wait until it shows 'Engine running'."
    Exit-Preflight
}
Ok "Docker is running ($(docker version --format '{{.Server.Version}}' 2>$null))"
$composeVersion = docker compose version --short 2>$null
if ($LASTEXITCODE -eq 0) { Ok "Docker Compose $composeVersion" }
else { Fail "Docker Compose v2 ('docker compose') is missing. Update Docker Desktop." }

# -- .env -------------------------------------------------------------------------
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Ok 'Created .env from .env.example'
} else {
    Ok '.env found'
}

$DataDir      = Get-EnvValue 'ZF_DATA_DIR' './data'
$OutputsDir   = Get-EnvValue 'ZF_OUTPUTS_DIR' './data/outputs'
$ModelsDir    = Get-EnvValue 'ZF_MODELS_DIR' './models'
$WorkflowsDir = Get-EnvValue 'ZF_WORKFLOWS_DIR' './workflows'
$Port         = [int](Get-EnvValue 'ZF_STUDIO_PORT' '3000')
$Bind         = Get-EnvValue 'ZF_BIND_ADDRESS' '127.0.0.1'

# -- Folders ----------------------------------------------------------------------
$folders = @(
    $DataDir, "$DataDir/wan2gp", "$DataDir/comfyui",
    $OutputsDir, "$OutputsDir/wan2gp", "$OutputsDir/comfyui",
    $WorkflowsDir,
    $ModelsDir, "$ModelsDir/wan2gp", "$ModelsDir/wan2gp-loras", "$ModelsDir/huggingface",
    "$ModelsDir/comfyui/checkpoints", "$ModelsDir/comfyui/diffusion_models", "$ModelsDir/comfyui/text_encoders",
    "$ModelsDir/comfyui/vae", "$ModelsDir/comfyui/clip_vision", "$ModelsDir/comfyui/loras", "$ModelsDir/comfyui/cosmos3"
)
$folderError = $false
foreach ($f in $folders) {
    try { New-Item -ItemType Directory -Force -Path $f -ErrorAction Stop | Out-Null }
    catch { Fail "Cannot create folder ${f}: $($_.Exception.Message)"; $folderError = $true }
}
if (-not $folderError) { Ok "Data folders ready ($DataDir, $ModelsDir, $WorkflowsDir)" }

# -- Disk space -------------------------------------------------------------------
$modelsFull = (Resolve-Path $ModelsDir).Path
$drive = Get-PSDrive -Name $modelsFull.Substring(0, 1) -ErrorAction SilentlyContinue
if ($StackProfile -eq 'mock') { $need = 5; $want = 10 } else { $need = 60; $want = 150 }
if (-not $drive) {
    Warn 'Could not measure free disk space.'
} else {
    $freeGb = [math]::Floor($drive.Free / 1GB)
    if ($freeGb -lt $need) { Fail "Only $freeGb GB free on drive $($drive.Name):; the '$StackProfile' profile needs at least $need GB (images + model weights)." }
    elseif ($freeGb -lt $want) { Warn "$freeGb GB free. Video models are large; $want GB+ is recommended." }
    else { Ok "$freeGb GB free on drive $($drive.Name):" }
    Write-Host "         Note: Docker images live in Docker Desktop's WSL2 disk (Settings > Resources > Disk image location)."
}

# -- Port -------------------------------------------------------------------------
$running = docker compose ps --status running --services 2>$null
if ($running -contains 'studio') {
    Ok "Studio already running on port $Port"
} else {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
        $owner = (Get-Process -Id $listener[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
        Fail "Port $Port is already in use by '$owner'. Stop that program or set ZF_STUDIO_PORT in .env."
    } else {
        Ok "Port $Port is free (bound to $Bind)"
    }
}

# -- GPU --------------------------------------------------------------------------
if ($StackProfile -ne 'mock') {
    Write-Host '  ...... testing GPU access in a container (first run downloads ~100 MB)'
    $gpu = docker run --rm --gpus all $CudaTestImage nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>&1
    if ($LASTEXITCODE -eq 0) {
        foreach ($line in @($gpu)) { Ok "GPU: $line" }
        $first = @($gpu)[0]
        if ($first -match ',\s*(\d+)\s*MiB') {
            if ([int]$Matches[1] -lt 12000) {
                Warn 'Less than 12 GB VRAM: large video models (Wan 2.2 14B, LTX-2.5, MiniMax H3) will be slow or fail; prefer the lighter variants.'
            }
        }
    } else {
        Fail ("Containers cannot see the NVIDIA GPU. Install the latest NVIDIA Game Ready/Studio driver on Windows (not inside WSL), " +
              "make sure Docker Desktop uses the WSL2 backend, run 'wsl --update', restart Docker Desktop, then retry. " +
              "Details: $(@($gpu) | Where-Object { "$_" -match 'nvidia-container-cli|error' } | Select-Object -Last 1)")
    }
}

# -- Models -----------------------------------------------------------------------
if ($StackProfile -in @('wan2gp', 'full')) {
    if (-not (Get-ChildItem "$ModelsDir/wan2gp" -Force -ErrorAction SilentlyContinue)) {
        Warn "$ModelsDir/wan2gp is empty. Wan2GP downloads weights on first use (internet needed, tens of GB)."
    } else { Ok 'Wan2GP weights folder has files' }
}
if ($StackProfile -in @('comfyui', 'full')) {
    if (-not (Get-ChildItem "$ModelsDir/comfyui" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
        Warn "$ModelsDir/comfyui has no model files. Put weights there before using ComfyUI models (see SETUP.md)."
    } else { Ok 'ComfyUI models folder has files' }
}

Exit-Preflight
