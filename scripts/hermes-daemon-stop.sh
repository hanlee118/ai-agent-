#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE="$ROOT_DIR/.runtime/hermes.pid"
PORT="${HERMES_PORT:-3001}"
HOST="${HERMES_HEALTH_HOST:-127.0.0.1}"
HEALTH_URL="http://${HOST}:${PORT}/mcp/health"

resolve_listener_pid() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1
}

if [ ! -f "$PID_FILE" ]; then
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    PID="$(resolve_listener_pid || true)"
    if [ -z "${PID:-}" ]; then
      echo "Hermes mock responds on :$PORT but listener PID is not resolvable"
      exit 0
    fi
  else
    echo "Hermes mock is not running"
    exit 0
  fi
else
  PID="$(cat "$PID_FILE")"
fi

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID" >/dev/null 2>&1 || true
  for _ in $(seq 1 10); do
    if ! kill -0 "$PID" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID" >/dev/null 2>&1 || true
  fi
  echo "Stopped Hermes mock PID $PID"
else
  echo "Stale Hermes PID file found for $PID"
fi

rm -f "$PID_FILE"
