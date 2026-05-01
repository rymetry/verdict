#!/usr/bin/env bash
# Post-tool-use targeted typecheck.
#
# Invoked by both Codex and Claude Code after Edit/Write tool use. Reads the
# JSON event from stdin and infers the changed file path; runs `pnpm
# typecheck` for the relevant workspace only (fast feedback ~3-15s).
#
# This is advisory: it never blocks the agent. Its role is to surface type
# errors at write-time rather than at PR-time.

set -uo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$PROJECT_ROOT" || exit 0

input="$(cat)"

# Extract a path from the event. Both tools use similar shapes; we look for
# a file-like string in the input.
file_path="$(printf '%s' "$input" | grep -oE '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]*)"/\1/')"
if [[ -z "$file_path" ]]; then
  file_path="$(printf '%s' "$input" | grep -oE '"path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"path"[[:space:]]*:[[:space:]]*"([^"]*)"/\1/')"
fi

# Ignore non-TS files and tooling files.
if [[ -z "$file_path" ]] || [[ ! "$file_path" =~ \.(ts|tsx|mts|cts)$ ]]; then
  exit 0
fi

# Resolve to a workspace.
case "$file_path" in
  */apps/agent/*)        target="@pwqa/agent" ;;
  */apps/web/*)          target="@pwqa/web" ;;
  */packages/shared/*)   target="@pwqa/shared" ;;
  *)
    # Out of workspace scope (e.g. tests/fixtures, .agents/) — skip.
    exit 0
    ;;
esac

# Skip if we are already inside an active typecheck (avoid re-entrancy when
# the agent edits files in a tight loop).
lock="${TMPDIR:-/tmp}/verdict-typecheck-${target##*/}.lock"
if [[ -f "$lock" ]]; then
  # Lock is older than 60s? Stale — proceed.
  if [[ -n "$(find "$lock" -mmin +1 2>/dev/null)" ]]; then
    rm -f "$lock"
  else
    exit 0
  fi
fi
echo $$ > "$lock"
trap 'rm -f "$lock"' EXIT

# Run scoped typecheck; suppress success output, surface failures.
output="$(pnpm --silent --filter "$target" typecheck 2>&1)"
status=$?

if [[ $status -ne 0 ]]; then
  printf '⚠️  Typecheck failed for %s after editing %s\n' "$target" "$file_path" >&2
  # Trim verbose output; keep first 30 lines so the agent sees the relevant errors.
  printf '%s\n' "$output" | head -n 30 >&2
fi

# Always exit 0 — this hook is advisory.
exit 0
