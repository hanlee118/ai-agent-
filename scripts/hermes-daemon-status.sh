#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE="$ROOT_DIR/.runtime/hermes.pid"
LOG_FILE="$ROOT_DIR/.runtime/hermes.log"
PORT="${HERMES_PORT:-3001}"
HOST="${HERMES_HEALTH_HOST:-127.0.0.1}"
HEALTH_URL="http://${HOST}:${PORT}/mcp/health"

resolve_listener_pid() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1
}

if [ ! -f "$PID_FILE" ]; then
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    PID="$(resolve_listener_pid || true)"
    if [ -n "${PID:-}" ]; then
      echo "$PID" > "$PID_FILE"
      echo "Hermes mock is responding on :$PORT, adopted PID $PID"
    else
      echo "Hermes mock is responding on :$PORT, but no PID file exists"
    fi
  else
    echo "Hermes mock is not running"
  fi
  exit 0
fi

PID="$(cat "$PID_FILE")"
if kill -0 "$PID" 2>/dev/null; then
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Hermes mock is running with PID $PID on :$PORT"
  else
    echo "Hermes mock process $PID exists, but /mcp/health is not responding on :$PORT"
    echo "Logs: $LOG_FILE"
  fi
else
  rm -f "$PID_FILE"
  echo "Hermes mock is not running (removed stale PID file: $PID)"
fi
