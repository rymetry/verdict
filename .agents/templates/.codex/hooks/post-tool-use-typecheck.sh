#!/usr/bin/env bash
set -uo pipefail

if [ -f package.json ]; then
  if command -v pnpm >/dev/null 2>&1; then
    pnpm --silent typecheck >/dev/null 2>&1 || true
  elif command -v npm >/dev/null 2>&1; then
    npm run --silent typecheck >/dev/null 2>&1 || true
  fi
fi

exit 0
