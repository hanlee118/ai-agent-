#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RUNTIME_DIR="$ROOT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/openclaw.pid"
LOG_FILE="$RUNTIME_DIR/openclaw.log"
PORT="${PORT:-8787}"
STARTUP_TIMEOUT="${STARTUP_TIMEOUT:-20}"

mkdir -p "$RUNTIME_DIR"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "OpenClaw is already running with PID $(cat "$PID_FILE") on :$PORT"
  exit 0
fi

if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "A service is already listening on :$PORT, refusing to start a duplicate instance"
  exit 1
fi

: > "$LOG_FILE"
nohup env PORT="$PORT" NODE_ENV=production ./scripts/start-local-prod.sh >> "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"

for _ in $(seq 1 "$STARTUP_TIMEOUT"); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "OpenClaw started with PID $PID on :$PORT"
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
