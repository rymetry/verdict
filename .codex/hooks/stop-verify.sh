#!/usr/bin/env bash
# Stop hook: final verification before yielding control back to the user.
#
# Invoked by both Codex and Claude Code at end-of-turn. Runs a compact
# verification gate so the agent does not hand off in a half-broken state:
#   - All workspace typecheck (cheap, ~5s)
#   - Quick git status check (any unintended changes?)
#
# This hook is advisory by default. It does NOT block; it surfaces problems
# so the agent can fix them in the next turn (or report them to the user).

set -uo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$PROJECT_ROOT" || exit 0

# Only run on the main project repo (skip nested worktrees / subprojects
# where this script may have been copied in).
case "$PROJECT_ROOT" in
  */verdict|*/playwright-workbench) ;;
  *)
    # Different repo or sandbox — do nothing.
    exit 0
    ;;
esac

# Skip if there are no recent edits (heuristic: nothing changed in the last
# 5 minutes). This avoids running on a "Stop" that comes from a Q&A turn
# with no code edits.
if [[ -z "$(find . -path ./node_modules -prune -o -path ./.git -prune -o -newermt '5 minutes ago' -print 2>/dev/null | head -n1)" ]]; then
  exit 0
fi

problems=()

# 1. Targeted typecheck. Whole-monorepo typecheck is ~10-15s and we already
# ran it on every PostToolUse(Edit|Write); on Stop we re-run it only for
# workspaces whose files were touched in the last 5 minutes.
touched_workspaces=()
for ws in agent web shared; do
  case "$ws" in
    agent)  base="apps/agent/src" ;;
    web)    base="apps/web/src" ;;
    shared) base="packages/shared/src" ;;
  esac
  if [[ -n "$(find "$base" -newermt '5 minutes ago' -name '*.ts' -o -name '*.tsx' -newermt '5 minutes ago' 2>/dev/null | head -n1)" ]]; then
    touched_workspaces+=("$ws")
  fi
done

for ws in "${touched_workspaces[@]}"; do
  pkg="@pwqa/$ws"
  if ! out="$(pnpm --silent --filter "$pkg" typecheck 2>&1)"; then
    problems+=("typecheck failed in $pkg:")
    problems+=("$(printf '%s' "$out" | tail -n 20)")
  fi
done

# 2. Sanity: there should not be conflict markers in any tracked file.
if conflicted="$(git --no-pager grep -l --exclude-standard -E '^(<<<<<<<|>>>>>>>|=======)$' -- ':!node_modules' 2>/dev/null)"; then
  if [[ -n "$conflicted" ]]; then
    problems+=("merge-conflict markers found in:")
    problems+=("$conflicted")
  fi
fi

# 3. Warn on staged but not committed changes (the user may want to commit
# before the agent yields).
if ! git diff --cached --quiet 2>/dev/null; then
  staged="$(git diff --cached --name-only | head -n 5 | tr '\n' ' ')"
  printf 'ℹ️  stop-verify: staged changes present (%s%s) — consider commit before yielding.\n' "$staged" "$(git diff --cached --name-only | wc -l | tr -d ' ' | xargs -I{} echo "({} total)")" >&2
fi

if [[ "${#problems[@]}" -gt 0 ]]; then
  printf '⚠️  stop-verify found problems before turn end:\n' >&2
  for p in "${problems[@]}"; do
    printf '  %s\n' "$p" >&2
  done
fi

# Always exit 0 — advisory.
exit 0
