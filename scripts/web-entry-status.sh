#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

OCC_ENTRY_CONTAINER="${OCC_ENTRY_CONTAINER:-occ-web-entry}"
TRADING_ENTRY_CONTAINER="${TRADING_ENTRY_CONTAINER:-tradingagents-nginx}"
ENTRY_PORT="${ENTRY_PORT:-80}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found"
  exit 1
fi

container_line() {
  local name="$1"
  docker ps -a --filter "name=^/${name}$" --format '{{.Names}}|{{.Status}}|{{.Ports}}' | head -n 1
}

OCC_LINE="$(container_line "$OCC_ENTRY_CONTAINER")"
TRADING_LINE="$(container_line "$TRADING_ENTRY_CONTAINER")"

echo "Entry Status"
echo "-----------"
if [ -n "$OCC_LINE" ]; then
  echo "occ-entry: $OCC_LINE"
else
  echo "occ-entry: <missing>"
fi

if [ -n "$TRADING_LINE" ]; then
  echo "tradingagents: $TRADING_LINE"
else
  echo "tradingagents: <missing>"
fi

echo
if curl -sf "http://127.0.0.1:${ENTRY_PORT}" >/dev/null 2>&1; then
  TITLE="$(curl -s "http://127.0.0.1:${ENTRY_PORT}" | sed -n 's:.*<title>\(.*\)</title>.*:\1:p' | head -n 1)"
  echo "http://127.0.0.1:${ENTRY_PORT} is healthy"
  if [ -n "${TITLE:-}" ]; then
    echo "title: ${TITLE}"
  fi
else
  echo "http://127.0.0.1:${ENTRY_PORT} is not reachable"
  exit 1
fi
