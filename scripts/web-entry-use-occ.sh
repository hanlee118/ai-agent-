#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

OCC_ENTRY_CONTAINER="${OCC_ENTRY_CONTAINER:-occ-web-entry}"
TRADING_ENTRY_CONTAINER="${TRADING_ENTRY_CONTAINER:-tradingagents-nginx}"
OCC_WEB_PORT="${OCC_WEB_PORT:-5173}"
ENTRY_PORT="${ENTRY_PORT:-80}"
CONF_SOURCE="$ROOT_DIR/scripts/nginx/occ-web-entry.conf"
CONF_RUNTIME="$ROOT_DIR/.runtime/occ-web-entry.nginx.conf"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found"
  exit 1
fi

if [ ! -f "$CONF_SOURCE" ]; then
  echo "missing nginx config: $CONF_SOURCE"
  exit 1
fi

mkdir -p "$ROOT_DIR/.runtime"
cp "$CONF_SOURCE" "$CONF_RUNTIME"

if [ -x "$ROOT_DIR/scripts/web-daemon-start.sh" ]; then
  "$ROOT_DIR/scripts/web-daemon-start.sh"
fi

if ! curl -sf "http://127.0.0.1:${OCC_WEB_PORT}" >/dev/null 2>&1; then
  echo "OCC web is not healthy on :$OCC_WEB_PORT"
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -Fxq "$TRADING_ENTRY_CONTAINER"; then
  docker stop "$TRADING_ENTRY_CONTAINER" >/dev/null
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$OCC_ENTRY_CONTAINER"; then
  docker rm -f "$OCC_ENTRY_CONTAINER" >/dev/null
fi

docker run -d \
  --name "$OCC_ENTRY_CONTAINER" \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p "${ENTRY_PORT}:80" \
  -v "${CONF_RUNTIME}:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine >/dev/null

for _ in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:${ENTRY_PORT}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -sf "http://127.0.0.1:${ENTRY_PORT}" >/dev/null 2>&1; then
  echo "entry port :$ENTRY_PORT did not become healthy"
  exit 1
fi

echo "Switched entry to OCC web."
echo "- entry: http://127.0.0.1:${ENTRY_PORT}"
echo "- target: http://127.0.0.1:${OCC_WEB_PORT}"
