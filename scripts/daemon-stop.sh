#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE="$ROOT_DIR/.runtime/openclaw.pid"

if [ ! -f "$PID_FILE" ]; then
  echo "OpenClaw is not running"
  exit 0
fi

PID="$(cat "$PID_FILE")"

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Stopped OpenClaw PID $PID"
else
  echo "Stale PID file found for $PID"
fi

rm -f "$PID_FILE"
