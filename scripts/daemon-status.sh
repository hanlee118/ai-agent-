#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE="$ROOT_DIR/.runtime/openclaw.pid"
PORT="${PORT:-8787}"
HEALTH_HOST="${HEALTH_HOST:-127.0.0.1}"
HEALTH_URL="http://${HEALTH_HOST}:${PORT}/health"
LOG_FILE="$ROOT_DIR/.runtime/openclaw.log"

if [ ! -f "$PID_FILE" ]; then
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "OpenClaw is responding on :$PORT, but no PID file exists"
  else
    echo "OpenClaw is not running"
  fi
  exit 0
fi

PID="$(cat "$PID_FILE")"

if kill -0 "$PID" 2>/dev/null; then
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "OpenClaw is running with PID $PID on :$PORT"
  else
    echo "OpenClaw process $PID exists, but /health is not responding on :$PORT"
    echo "Logs: $LOG_FILE"
  fi
else
  rm -f "$PID_FILE"
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "OpenClaw is responding on :$PORT, removed stale PID file: $PID"
  else
    echo "OpenClaw is not running (removed stale PID file: $PID)"
  fi
fi
