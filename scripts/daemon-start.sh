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

resolve_listener_pid() {
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1
}

spawn_server() {
  python3 - "$ROOT_DIR" "$LOG_FILE" "$PORT" "$HOST" <<'PY'
import os
import subprocess
import sys

root_dir, log_file, port, host = sys.argv[1:5]
env = os.environ.copy()
env["PORT"] = port
env["HOST"] = host
env["NODE_ENV"] = env.get("NODE_ENV", "production")

with open(log_file, "ab", buffering=0) as stream:
    proc = subprocess.Popen(
        ["./scripts/start-local-prod.sh"],
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
}

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
  LISTENER_PID="$(resolve_listener_pid || true)"
  if [ -n "${LISTENER_PID:-}" ]; then
    echo "$LISTENER_PID" > "$PID_FILE"
    echo "OpenClaw is already healthy on :$PORT ($HEALTH_URL), adopted PID $LISTENER_PID"
  else
    echo "OpenClaw is already healthy on :$PORT ($HEALTH_URL)"
  fi
  exit 0
fi

: > "$LOG_FILE"
PID="$(spawn_server)"
echo "$PID" > "$PID_FILE"

for _ in $(seq 1 "$STARTUP_TIMEOUT"); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    sleep 1
    LISTENER_PID="$(resolve_listener_pid || true)"
    if [ -n "${LISTENER_PID:-}" ]; then
      echo "$LISTENER_PID" > "$PID_FILE"
      PID="$LISTENER_PID"
    fi
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
