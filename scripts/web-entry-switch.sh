#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

ACTION="${1:-status}"

case "$ACTION" in
  occ)
    "$ROOT_DIR/scripts/web-entry-use-occ.sh"
    ;;
  trading|tradingagents)
    "$ROOT_DIR/scripts/web-entry-use-tradingagents.sh"
    ;;
  status)
    "$ROOT_DIR/scripts/web-entry-status.sh"
    ;;
  *)
    echo "Usage: $0 [occ|trading|status]"
    exit 1
    ;;
esac
