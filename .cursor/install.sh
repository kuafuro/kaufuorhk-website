#!/usr/bin/env bash
# Idempotent Cloud Agent startup script — safe to run on every agent boot.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -f "$ROOT/whatsapp-bot/package.json" ]; then
  (cd "$ROOT/whatsapp-bot" && npm install --no-fund --no-audit)
fi
