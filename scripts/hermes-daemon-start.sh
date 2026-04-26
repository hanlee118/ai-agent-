#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

RUNTIME_DIR="$ROOT_DIR/.runtime"
PID_FILE="$RUNTIME_DIR/hermes.pid"
LOG_FILE="$RUNTIME_DIR/hermes.log"
PORT="${HERMES_PORT:-3001}"
HOST="${HERMES_HEALTH_HOST:-127.0.0.1}"
HEALTH_URL="http://${HOST}:${PORT}/mcp/health"
STARTUP_TIMEOUT="${HERMES_STARTUP_TIMEOUT:-20}"

mkdir -p "$RUNTIME_DIR"

resolve_listener_pid() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1
}

if [ -f "$PID_FILE" ]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "Hermes mock is already running with PID $EXISTING_PID on :$PORT"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
  LISTENER_PID="$(resolve_listener_pid || true)"
  if [ -n "${LISTENER_PID:-}" ]; then
    echo "$LISTENER_PID" > "$PID_FILE"
    echo "Hermes mock already healthy on :$PORT ($HEALTH_URL), adopted PID $LISTENER_PID"
  else
    echo "Hermes mock already healthy on :$PORT ($HEALTH_URL)"
  fi
  exit 0
fi

: > "$LOG_FILE"
PID="$(python3 - "$ROOT_DIR" "$LOG_FILE" "$PORT" <<'PY'
import os
import subprocess
import sys

root_dir, log_file, port = sys.argv[1:4]
env = os.environ.copy()
env["PORT"] = port
env["SERVICE_ROLE"] = "hermes"

with open(log_file, "ab", buffering=0) as stream:
    proc = subprocess.Popen(
        ["node", "apps/platform-v21/services/agent-runtime-mock/server.mjs"],
        cwd=root_dir,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=stream,
        stderr=subprocess.STDOUT,
        start_new_session=True,
        close_fds=True,
    )

print(proc.pid)
PY
)"
echo "$PID" > "$PID_FILE"

for _ in $(seq 1 "$STARTUP_TIMEOUT"); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    LISTENER_PID="$(resolve_listener_pid || true)"
    if [ -n "${LISTENER_PID:-}" ]; then
      echo "$LISTENER_PID" > "$PID_FILE"
      PID="$LISTENER_PID"
    fi
    echo "Hermes mock started with PID $PID on :$PORT"
    echo "Health: $HEALTH_URL"
    echo "Logs: $LOG_FILE"
    exit 0
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Hermes mock failed during startup" >&2
    tail -n 80 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    exit 1
  fi
  sleep 1
done

echo "Hermes mock did not become healthy within ${STARTUP_TIMEOUT}s" >&2
tail -n 80 "$LOG_FILE" >&2 || true
kill "$PID" >/dev/null 2>&1 || true
rm -f "$PID_FILE"
exit 1
