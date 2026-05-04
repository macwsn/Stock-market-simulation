#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8080}"
export PORT

cd "$(dirname "$0")"

echo "Starting stock-market-simulation on http://localhost:${PORT}"

docker compose down -v --remove-orphans 2>/dev/null || true

docker compose up --build -d

echo "Waiting for HAProxy + backends to become ready..."
deadline=$(( $(date +%s) + 120 ))
while (( $(date +%s) < deadline )); do
    if curl -sf "http://localhost:${PORT}/healthz" >/dev/null 2>&1 \
        && curl -sf "http://localhost:${PORT}/stocks" >/dev/null 2>&1; then
        echo "Ready. API at http://localhost:${PORT}"
        exit 0
    fi
    sleep 1
done

echo "Service did not become ready within 120s" >&2
docker compose ps
exit 1
