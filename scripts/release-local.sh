#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$ROOT_DIR/.cache}"
export HOST="${HOST:-127.0.0.1}"
mkdir -p "$XDG_CACHE_HOME"

API_PID=""

cleanup() {
  if [ -n "$API_PID" ] && kill -0 "$API_PID" >/dev/null 2>&1; then
    kill "$API_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

if [ -d "node_modules" ]; then
  echo "[1/5] Dependencies already present, skipping install"
else
  echo "[1/5] Installing dependencies"
  CI=true pnpm install
fi

echo "[2/5] Generating Prisma client"
pnpm --filter @occ/api db:generate

echo "[3/5] Syncing database schema"
if ! pnpm --filter @occ/api db:push; then
  echo "Prisma db:push failed, falling back to SQL bootstrap + seed"
  pnpm --filter @occ/api db:bootstrap
  pnpm --filter @occ/api db:seed
fi

echo "[4/5] Building web and api"
pnpm build

echo "[5/5] Running release smoke verification"
if curl -sf http://127.0.0.1:8787/health >/dev/null 2>&1; then
  echo "Existing API detected on :8787, reusing it for smoke test"
else
  echo "Starting temporary production API for smoke test"
  PORT=8787 HOST="$HOST" NODE_ENV=production node apps/api/dist/index.js > /tmp/occ-release-api.log 2>&1 &
  API_PID=$!

  for attempt in $(seq 1 30); do
    if curl -sf http://127.0.0.1:8787/health >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if ! curl -sf http://127.0.0.1:8787/health >/dev/null 2>&1; then
    echo "Temporary production API failed to start" >&2
    cat /tmp/occ-release-api.log >&2 || true
    exit 1
  fi
fi

pnpm test:smoke

echo "Release artifacts ready"
echo "Run: ./scripts/start-local-prod.sh"
echo "Verify: pnpm test:smoke"
