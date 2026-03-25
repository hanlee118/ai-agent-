#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

BACKUP_ROOT="${BACKUP_ROOT:-$ROOT_DIR/backups}"
TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
TARGET_DIR="$BACKUP_ROOT/$TIMESTAMP"
DB_SOURCE=""

mkdir -p "$TARGET_DIR"

for candidate in "apps/api/prisma/dev.db" "apps/api/dev.db"; do
  if [ -f "$candidate" ]; then
    DB_SOURCE="$candidate"
    break
  fi
done

if [ -z "$DB_SOURCE" ]; then
  echo "Could not find SQLite database file"
  exit 1
fi

cp "$DB_SOURCE" "$TARGET_DIR/dev.db"

if [ -f ".occ-secret" ]; then
  cp .occ-secret "$TARGET_DIR/.occ-secret"
fi

cat > "$TARGET_DIR/manifest.json" <<EOF
{
  "createdAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "database": "$DB_SOURCE",
  "includesSecret": $( [ -f ".occ-secret" ] && echo "true" || echo "false" )
}
EOF

echo "Backup created at $TARGET_DIR"
