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

if docker ps -a --format '{{.Names}}' | grep -Fxq "$OCC_ENTRY_CONTAINER"; then
  docker rm -f "$OCC_ENTRY_CONTAINER" >/dev/null
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "$TRADING_ENTRY_CONTAINER"; then
  if ! docker ps --format '{{.Names}}' | grep -Fxq "$TRADING_ENTRY_CONTAINER"; then
    docker start "$TRADING_ENTRY_CONTAINER" >/dev/null
  fi
else
  echo "tradingagents nginx container not found: $TRADING_ENTRY_CONTAINER"
  exit 1
fi

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

echo "Switched entry to TradingAgents."
echo "- entry: http://127.0.0.1:${ENTRY_PORT}"
