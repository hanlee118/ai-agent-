#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$ROOT_DIR/.cache}"
mkdir -p "$XDG_CACHE_HOME"

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

echo "[5/5] Release artifacts ready"
echo "Run: ./scripts/start-local-prod.sh"
echo "Verify: pnpm verify:local"
