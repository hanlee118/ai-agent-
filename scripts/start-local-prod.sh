#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${PORT:-8787}"
export NODE_ENV="${NODE_ENV:-production}"
export PORT

exec node apps/api/dist/index.js
