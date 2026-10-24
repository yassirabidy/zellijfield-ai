#!/usr/bin/env bash
# Start Zellijfield AI.  Usage: ./start.sh [mock|wan2gp|comfyui|full]   (default: mock)
set -euo pipefail
cd "$(dirname "$0")"

PROFILE="${1:-mock}"
case "$PROFILE" in
    mock|wan2gp|comfyui|full) ;;
    *) echo "Unknown profile '$PROFILE'. Use one of: mock, wan2gp, comfyui, full." >&2; exit 2 ;;
esac

./preflight.sh "$PROFILE"

echo
echo "Building and starting the '$PROFILE' stack (the first GPU build can take 30-60 minutes)..."
docker compose --profile "$PROFILE" up -d --build

port="$(grep -E '^ZF_STUDIO_PORT=' .env 2>/dev/null | tail -n 1 | cut -d= -f2 | tr -d '\r')"
port="${port:-3000}"
echo "Waiting for the studio to become healthy..."
for _ in $(seq 1 60); do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q studio)" 2>/dev/null || true)"
    if [ "$status" = "healthy" ]; then
        echo
        echo "Zellijfield AI is running: http://127.0.0.1:${port}"
        [ "$PROFILE" != "mock" ] && echo "GPU services keep loading in the background: docker compose logs -f"
        exit 0
    fi
    sleep 2
done
echo "The studio did not report healthy within 2 minutes. Check: docker compose logs studio" >&2
exit 1
