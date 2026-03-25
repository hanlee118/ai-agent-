#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RUNTIME_DIR="$ROOT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/openclaw.pid"
LOG_FILE="$RUNTIME_DIR/openclaw.log"

mkdir -p "$RUNTIME_DIR"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "OpenClaw is already running with PID $(cat "$PID_FILE")"
  exit 0
fi

nohup ./scripts/start-local-prod.sh >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

echo "OpenClaw started with PID $(cat "$PID_FILE")"
echo "Logs: $LOG_FILE"
