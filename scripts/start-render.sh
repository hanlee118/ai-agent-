#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-10000}"
export DATABASE_URL="${DATABASE_URL:-postgresql://occ:occ@127.0.0.1:5432/occ?schema=public}"
export OPENCLAW_ROOT="${OPENCLAW_ROOT:-/var/data/openclaw}"
export OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$OPENCLAW_ROOT/openclaw.json}"
export OPENCLAW_WORKSPACE_ROOT="${OPENCLAW_WORKSPACE_ROOT:-$OPENCLAW_ROOT/workspace}"
export MODEL_PROVIDER="${MODEL_PROVIDER:-scripted}"

mkdir -p "$OPENCLAW_WORKSPACE_ROOT"
mkdir -p "$OPENCLAW_ROOT/agents"

exec node apps/api/dist/index.js
