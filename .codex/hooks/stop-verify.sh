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

# Only run on the Verdict repo. Detect via remote URL so per-session
# worktrees (e.g. .claude/worktrees/<name>) still match. Falls back to
# package.json name when no remote is configured.
remote_url="$(git config --get remote.origin.url 2>/dev/null || true)"
case "$remote_url" in
  *rymetry/verdict*|*rymetry/playwright-workbench*) ;;
  "")
    # No remote — accept if root package.json claims the workspace.
    if ! grep -q '"name": *"playwright-workbench"' package.json 2>/dev/null; then
      exit 0
    fi
    ;;
  *)
    # Some other repo (the script may have been copied as a template).
    exit 0
    ;;
esac

# Skip if there are no recent edits. `find -mmin` is portable across BSD
# (macOS) and GNU find. Look for files modified in the last 5 minutes,
# excluding noisy paths.
if [[ -z "$(find . \
    -path ./node_modules -prune -o \
    -path ./.git -prune -o \
    -path ./dist -prune -o \
    -path ./.playwright-mcp -prune -o \
    -name '*.ts' -mmin -5 -print -o \
    -name '*.tsx' -mmin -5 -print -o \
    -name '*.json' -mmin -5 -print 2>/dev/null | head -n1)" ]]; then
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
  # Portable across BSD (macOS) and GNU find: `-mmin -5` = modified in
  # the last 5 minutes.
  if [[ -d "$base" ]] && [[ -n "$(find "$base" \( -name '*.ts' -o -name '*.tsx' \) -mmin -5 2>/dev/null | head -n1)" ]]; then
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
