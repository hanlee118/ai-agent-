#!/usr/bin/env bash
set -euo pipefail

if [ "${OCC_FORCE_RESTORE:-}" != "1" ]; then
  echo "Refusing to restore without OCC_FORCE_RESTORE=1"
  exit 1
fi

if [ $# -ne 1 ]; then
  echo "Usage: OCC_FORCE_RESTORE=1 ./scripts/restore-local.sh <backup-dir>"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

SOURCE_DIR="$1"
DB_TARGET="apps/api/prisma/dev.db"

if [ ! -d "$SOURCE_DIR" ]; then
  echo "Backup directory not found: $SOURCE_DIR"
  exit 1
fi

if [ ! -f "$SOURCE_DIR/dev.db" ]; then
  echo "Missing dev.db in backup directory"
  exit 1
fi

if [ ! -f "$DB_TARGET" ] && [ -f "apps/api/dev.db" ]; then
  DB_TARGET="apps/api/dev.db"
fi

cp "$SOURCE_DIR/dev.db" "$DB_TARGET"

if [ -f "$SOURCE_DIR/.occ-secret" ]; then
  cp "$SOURCE_DIR/.occ-secret" .occ-secret
fi

echo "Restore completed from $SOURCE_DIR to $DB_TARGET"
