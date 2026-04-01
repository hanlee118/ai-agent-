#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE="$ROOT_DIR/.runtime/openclaw.pid"
PORT="${PORT:-8787}"
HEALTH_HOST="${HEALTH_HOST:-127.0.0.1}"
HEALTH_URL="http://${HEALTH_HOST}:${PORT}/health"

if [ ! -f "$PID_FILE" ]; then
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    echo "OpenClaw responds on :$PORT but no PID file exists; nothing to stop safely"
  else
    echo "OpenClaw is not running"
  fi
  exit 0
fi

PID="$(cat "$PID_FILE")"

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  for _ in $(seq 1 10); do
    if ! kill -0 "$PID" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID" >/dev/null 2>&1 || true
  fi

  echo "Stopped OpenClaw PID $PID"
else
  echo "Stale PID file found for $PID"
fi

rm -f "$PID_FILE"
