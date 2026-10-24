#!/usr/bin/env bash
# Stop every Zellijfield AI container. Images, models and data are kept.
set -euo pipefail
cd "$(dirname "$0")"
docker compose --profile full down
echo "Zellijfield AI stopped."
