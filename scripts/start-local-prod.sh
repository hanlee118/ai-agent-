#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

load_env_file_preserving_existing() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    if [[ "$line" != *=* ]]; then
      continue
    fi
    local key="${line%%=*}"
    local raw_value="${line#*=}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    if [ -z "$key" ]; then
      continue
    fi
    if [ -n "${!key+x}" ]; then
      continue
    fi
    eval "export ${key}=${raw_value}"
  done < "$env_file"
}

load_env_file_preserving_existing "$ROOT_DIR/apps/api/.env"

PORT="${PORT:-8787}"
HOST="${HOST:-0.0.0.0}"
export NODE_ENV="${NODE_ENV:-production}"
export DESIGN_STITCH_MODE="${DESIGN_STITCH_MODE:-preferred}"
export WORKFLOW_V2_HERMES_ENDPOINT="${WORKFLOW_V2_HERMES_ENDPOINT:-http://127.0.0.1:3001}"
export WORKFLOW_V2_HERMES_STAGE_MATCH="${WORKFLOW_V2_HERMES_STAGE_MATCH:-all}"
export PORT
export HOST

exec node apps/api/dist/index.js
