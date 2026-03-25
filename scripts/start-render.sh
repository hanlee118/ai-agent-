#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-10000}"
export DATABASE_URL="${DATABASE_URL:-file:/var/data/occ/dev.db}"
export OPENCLAW_ROOT="${OPENCLAW_ROOT:-/var/data/openclaw}"
export OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$OPENCLAW_ROOT/openclaw.json}"
export OPENCLAW_WORKSPACE_ROOT="${OPENCLAW_WORKSPACE_ROOT:-$OPENCLAW_ROOT/workspace}"
export MODEL_PROVIDER="${MODEL_PROVIDER:-scripted}"

DB_FILE="${DATABASE_URL#file:}"
DB_DIR="$(dirname "$DB_FILE")"

mkdir -p "$DB_DIR"
mkdir -p "$OPENCLAW_WORKSPACE_ROOT"
mkdir -p "$OPENCLAW_ROOT/agents"

if [ ! -f "$DB_FILE" ]; then
  echo "Bootstrapping SQLite schema at $DB_FILE"
  sqlite3 "$DB_FILE" < apps/api/prisma/bootstrap.sql
fi

exec node apps/api/dist/index.js
