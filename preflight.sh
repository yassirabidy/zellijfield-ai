#!/usr/bin/env bash
# Zellijfield AI preflight — checks Docker, GPU access, disk space, ports and model folders.
# Usage: ./preflight.sh [mock|wan2gp|comfyui|full]     (default: mock)
set -uo pipefail

cd "$(dirname "$0")"

PROFILE="${1:-mock}"
case "$PROFILE" in
    mock|wan2gp|comfyui|full) ;;
    *) echo "Unknown profile '$PROFILE'. Use one of: mock, wan2gp, comfyui, full." >&2; exit 2 ;;
esac

CUDA_TEST_IMAGE="nvidia/cuda:12.8.1-base-ubuntu22.04"
FAILS=0
ok()   { printf '  [ OK ] %s\n' "$1"; }
warn() { printf '  [WARN] %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; FAILS=$((FAILS + 1)); }

# Read KEY=value from .env without executing it.
env_value() {
    local key="$1" default="$2" line
    line="$(grep -E "^${key}=" .env 2>/dev/null | tail -n 1 | tr -d '\r')"
    if [ -n "$line" ]; then printf '%s' "${line#*=}"; else printf '%s' "$default"; fi
}

echo "Zellijfield AI preflight (profile: $PROFILE)"

# -- Docker ------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
    fail "Docker is not installed. Install Docker Desktop (Windows/Mac) or Docker Engine (Linux)."
    echo; echo "Preflight failed."; exit 1
fi
if docker info >/dev/null 2>&1; then
    ok "Docker is running ($(docker version --format '{{.Server.Version}}' 2>/dev/null))"
else
    fail "Docker is installed but not running. Start Docker Desktop and wait until it says 'Engine running'."
    echo; echo "Preflight failed."; exit 1
fi
if docker compose version >/dev/null 2>&1; then
    ok "Docker Compose $(docker compose version --short 2>/dev/null)"
else
    fail "Docker Compose v2 is missing ('docker compose'). Update Docker Desktop / install the compose plugin."
fi

# -- .env --------------------------------------------------------------------------
if [ ! -f .env ]; then
    cp .env.example .env && ok "Created .env from .env.example" || fail "Could not create .env"
else
    ok ".env found"
fi

DATA_DIR="$(env_value ZF_DATA_DIR ./data)"
OUTPUTS_DIR="$(env_value ZF_OUTPUTS_DIR ./data/outputs)"
MODELS_DIR="$(env_value ZF_MODELS_DIR ./models)"
WORKFLOWS_DIR="$(env_value ZF_WORKFLOWS_DIR ./workflows)"
PORT="$(env_value ZF_STUDIO_PORT 3000)"
BIND="$(env_value ZF_BIND_ADDRESS 127.0.0.1)"

# -- Folders (created here so Docker does not create them as root) ----------------
for d in "$DATA_DIR" "$DATA_DIR/wan2gp" "$DATA_DIR/comfyui" \
         "$OUTPUTS_DIR" "$OUTPUTS_DIR/wan2gp" "$OUTPUTS_DIR/comfyui" \
         "$WORKFLOWS_DIR" \
         "$MODELS_DIR" "$MODELS_DIR/wan2gp" "$MODELS_DIR/wan2gp-loras" "$MODELS_DIR/huggingface" \
         "$MODELS_DIR/comfyui/checkpoints" "$MODELS_DIR/comfyui/diffusion_models" \
         "$MODELS_DIR/comfyui/text_encoders" "$MODELS_DIR/comfyui/vae" \
         "$MODELS_DIR/comfyui/clip_vision" "$MODELS_DIR/comfyui/loras" "$MODELS_DIR/comfyui/cosmos3"; do
    if ! mkdir -p "$d" 2>/dev/null; then fail "Cannot create folder $d"; fi
done
[ -w "$DATA_DIR" ] && ok "Data folders ready ($DATA_DIR, $MODELS_DIR, $WORKFLOWS_DIR)" || fail "$DATA_DIR is not writable"

# -- Disk space --------------------------------------------------------------------
free_gb="$(df -Pk "$MODELS_DIR" 2>/dev/null | awk 'NR==2 {printf "%d", $4 / 1048576}')"
if [ "$PROFILE" = "mock" ]; then need=5; want=10; else need=60; want=150; fi
if [ -z "$free_gb" ]; then
    warn "Could not measure free disk space."
elif [ "$free_gb" -lt "$need" ]; then
    fail "Only ${free_gb} GB free next to $MODELS_DIR; the '$PROFILE' profile needs at least ${need} GB (images + model weights)."
elif [ "$free_gb" -lt "$want" ]; then
    warn "${free_gb} GB free. Video models are large; ${want} GB+ is recommended."
else
    ok "${free_gb} GB free disk space"
fi

# -- Port --------------------------------------------------------------------------
studio_running="$(docker compose ps --status running --services 2>/dev/null | grep -x studio || true)"
if [ -n "$studio_running" ]; then
    ok "Studio already running on port $PORT"
elif (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then
    fail "Port $PORT is already in use by another program. Stop it or set ZF_STUDIO_PORT in .env."
else
    ok "Port $PORT is free (bound to $BIND)"
fi

# -- GPU ---------------------------------------------------------------------------
if [ "$PROFILE" != "mock" ]; then
    echo "  ...... testing GPU access in a container (first run downloads ~100 MB)"
    if gpu="$(docker run --rm --gpus all "$CUDA_TEST_IMAGE" nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>&1)"; then
        while IFS= read -r line; do ok "GPU: $line"; done <<< "$gpu"
        vram_mb="$(printf '%s\n' "$gpu" | head -n 1 | awk -F', ' '{print $2}' | grep -oE '[0-9]+' | head -n 1)"
        if [ -n "$vram_mb" ] && [ "$vram_mb" -lt 12000 ]; then
            warn "Less than 12 GB VRAM: large video models (Wan 2.2 14B, LTX-2.5, MiniMax H3) will be slow or fail; prefer the lighter variants."
        fi
    else
        fail "Containers cannot see the NVIDIA GPU. Install the latest NVIDIA driver, enable WSL2 GPU support in Docker Desktop (Linux: install nvidia-container-toolkit), then retry. Details: $( { printf '%s\n' "$gpu" | grep -i -m 1 'nvidia-container-cli' || printf '%s\n' "$gpu" | grep -i -m 1 'error'; } | cut -c1-300)"
    fi
fi

# -- Models ------------------------------------------------------------------------
if [ "$PROFILE" = "wan2gp" ] || [ "$PROFILE" = "full" ]; then
    if [ -z "$(ls -A "$MODELS_DIR/wan2gp" 2>/dev/null)" ]; then
        warn "$MODELS_DIR/wan2gp is empty. Wan2GP downloads weights on first use (internet needed, tens of GB)."
    else
        ok "Wan2GP weights folder has files"
    fi
fi
if [ "$PROFILE" = "comfyui" ] || [ "$PROFILE" = "full" ]; then
    if [ -z "$(find "$MODELS_DIR/comfyui" -type f 2>/dev/null | head -n 1)" ]; then
        warn "$MODELS_DIR/comfyui has no model files. Put weights there before using ComfyUI models (see SETUP.md)."
    else
        ok "ComfyUI models folder has files"
    fi
fi

echo
if [ "$FAILS" -gt 0 ]; then
    echo "Preflight failed with $FAILS problem(s). Fix the [FAIL] items above and run it again."
    exit 1
fi
echo "Preflight passed."
