#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RUNTIME_DIR="$ROOT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/openclaw.pid"
LOG_FILE="$RUNTIME_DIR/openclaw.log"
PORT="${PORT:-8787}"
HOST="${HOST:-0.0.0.0}"
HEALTH_HOST="${HEALTH_HOST:-127.0.0.1}"
HEALTH_URL="http://${HEALTH_HOST}:${PORT}/health"
STARTUP_TIMEOUT="${STARTUP_TIMEOUT:-20}"

mkdir -p "$RUNTIME_DIR"

if [ -f "$PID_FILE" ]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "OpenClaw is already running with PID $EXISTING_PID on :$PORT"
    exit 0
  fi

  echo "Removing stale PID file ($EXISTING_PID)"
  rm -f "$PID_FILE"
fi

if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
  echo "OpenClaw is already healthy on :$PORT ($HEALTH_URL)"
  exit 0
fi

: > "$LOG_FILE"
nohup env PORT="$PORT" HOST="$HOST" NODE_ENV=production ./scripts/start-local-prod.sh >> "$LOG_FILE" 2>&1 < /dev/null &
PID=$!
echo "$PID" > "$PID_FILE"

for _ in $(seq 1 "$STARTUP_TIMEOUT"); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    sleep 1
    if ! kill -0 "$PID" 2>/dev/null; then
      echo "OpenClaw became healthy but exited immediately afterwards" >&2
      tail -n 80 "$LOG_FILE" >&2 || true
      rm -f "$PID_FILE"
      exit 1
    fi

    echo "OpenClaw started with PID $PID on :$PORT"
    echo "Health: $HEALTH_URL"
    echo "Logs: $LOG_FILE"
    exit 0
  fi

  if ! kill -0 "$PID" 2>/dev/null; then
    echo "OpenClaw failed to stay alive during startup" >&2
    tail -n 80 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    exit 1
  fi

  sleep 1
done

echo "OpenClaw did not become healthy within ${STARTUP_TIMEOUT}s" >&2
tail -n 80 "$LOG_FILE" >&2 || true
kill "$PID" >/dev/null 2>&1 || true
rm -f "$PID_FILE"
exit 1
