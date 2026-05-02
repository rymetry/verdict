#!/usr/bin/env bash
set -uo pipefail

input="$(cat)"

if [[ "$input" == *git* && "$input" == *push* && "$input" == *main* ]] &&
  [[ "$input" == *"--force"* || "$input" == *"--force-with-lease"* || "$input" == *" -f"* ]]; then
  echo "Blocked: force push to main is not allowed." >&2
  exit 2
fi

case "$input" in
  *git*push*"+main"*|*git*push*"+refs/heads/main"*)
    echo "Blocked: forced main refspec is not allowed." >&2
    exit 2
    ;;
  *git*push*+*:main*|*git*push*+*:refs/heads/main*)
    echo "Blocked: forced destination refspec to main is not allowed." >&2
    exit 2
    ;;
esac

exit 0
