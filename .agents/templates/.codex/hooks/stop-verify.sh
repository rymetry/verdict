#!/usr/bin/env bash
set -uo pipefail

matches="$(git --no-pager grep -n -E '^(<<<<<<<|>>>>>>>|=======)$' -- ':!node_modules' 2>/dev/null || true)"
if [ -n "$matches" ]; then
  echo "Conflict markers found:" >&2
  printf '%s\n' "$matches" >&2
  exit 2
fi

exit 0
