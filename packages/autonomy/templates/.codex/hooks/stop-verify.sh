#!/usr/bin/env bash
set -uo pipefail

if git --no-pager grep -l --exclude-standard -E '^(<<<<<<<|>>>>>>>|=======)$' -- ':!node_modules' >/tmp/agents-conflicts.$$ 2>/dev/null; then
  if [ -s /tmp/agents-conflicts.$$ ]; then
    echo "Conflict markers found:" >&2
    cat /tmp/agents-conflicts.$$ >&2
  fi
fi
rm -f /tmp/agents-conflicts.$$

exit 0
