#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE="$ROOT_DIR/.runtime/openclaw.pid"
PORT="${PORT:-8787}"
LOG_FILE="$ROOT_DIR/.runtime/openclaw.log"

if [ ! -f "$PID_FILE" ]; then
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "OpenClaw is responding on :$PORT, but no PID file exists"
  else
    echo "OpenClaw is not running"
  fi
  exit 0
fi

PID="$(cat "$PID_FILE")"

if kill -0 "$PID" 2>/dev/null; then
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "OpenClaw is running with PID $PID on :$PORT"
  else
    echo "OpenClaw process $PID exists, but /health is not responding on :$PORT"
    echo "Logs: $LOG_FILE"
  fi
else
  echo "OpenClaw is not running but PID file exists: $PID"
fi
