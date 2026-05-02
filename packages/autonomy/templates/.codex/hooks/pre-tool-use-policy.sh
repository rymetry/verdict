#!/usr/bin/env bash
set -uo pipefail

input="$(cat)"

case "$input" in
  *"git push --force"*main*|*"git push -f"*main*)
    echo "Blocked: force push to main is not allowed." >&2
    exit 2
    ;;
esac

exit 0
