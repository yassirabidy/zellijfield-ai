#!/usr/bin/env bash
# Starts WanGP as a headless MCP server (API v1, Streamable HTTP) — docs/API.md "MCP Server".
# Binds 0.0.0.0 inside the container only; compose publishes no port, so it is reachable
# solely from the studio over the compose network. Extra wgp.py flags may be passed as
# container arguments (compose `command:`); they are appended verbatim, never shell-evaluated.
set -euo pipefail

cd /opt/wan2gp

# Thread pools sized to the container, as in Wan2GP's own entrypoint.sh.
threads="$(nproc)"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-$threads}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-$threads}"

if command -v nvidia-smi >/dev/null 2>&1; then
    nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader || true
else
    echo "WARNING: nvidia-smi not found — the container has no GPU access. Check the GPU override / Docker Desktop WSL2 GPU support." >&2
fi

mkdir -p /config/settings

exec python3 wgp.py \
    --mcp \
    --mcp-api-version 1 \
    --mcp-transport streamable-http \
    --mcp-host 0.0.0.0 \
    --mcp-port "${WAN2GP_MCP_PORT:-7866}" \
    --config /config \
    --settings /config/settings \
    --output-dir /outputs \
    "$@"
