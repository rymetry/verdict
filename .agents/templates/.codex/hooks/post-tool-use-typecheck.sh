#!/usr/bin/env bash
set -uo pipefail

if [ "${AGENTS_HOOK_RUN_TYPECHECK:-0}" = "1" ] && [ -f package.json ]; then
  if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
    pnpm --silent typecheck >/dev/null 2>&1 || true
  elif [ -f package-lock.json ] && command -v npm >/dev/null 2>&1; then
    npm run --silent typecheck >/dev/null 2>&1 || true
  elif [ -f yarn.lock ] && command -v yarn >/dev/null 2>&1; then
    yarn --silent typecheck >/dev/null 2>&1 || true
  elif { [ -f bun.lock ] || [ -f bun.lockb ]; } && command -v bun >/dev/null 2>&1; then
    bun run typecheck >/dev/null 2>&1 || true
  elif command -v npm >/dev/null 2>&1; then
    npm run --silent typecheck >/dev/null 2>&1 || true
  fi
fi

exit 0
