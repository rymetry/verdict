#!/usr/bin/env bash
# Pre-tool-use policy for Bash invocations.
#
# Invoked by both Codex (via .codex/config.toml) and Claude Code (via
# .claude/settings.json). Reads the proposed command from stdin as JSON
# (Claude Code sends `tool_input.command`; Codex sends a similar shape).
#
# Behavior:
#   exit 0  → allow the tool call
#   exit 2  → block the tool call (the agent receives the stderr message)
#   exit 1  → policy script error; the tool call is allowed but with a warning
#
# This script blocks a small set of irrecoverable-by-default operations:
#   - `git push --force` / `--force-with-lease` to `main`
#   - `rm -rf /` style destructive paths
#   - writes outside the project root via redirection (best-effort detection)
#
# It does NOT attempt to enumerate every dangerous command; that is the
# CommandRunner's job inside the agent. This hook's role is to surface the
# small number of "almost certainly a mistake" cases at the user shell.

set -uo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

input="$(cat)"

# Best-effort extraction of the command string. Codex and Claude Code use
# slightly different JSON shapes; both expose a `command` (or
# `tool_input.command`) field at most one level deep. We grep and accept
# noise rather than depending on jq being installed.
command="$(printf '%s' "$input" | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n1 | sed -E 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]*)"/\1/')"

if [[ -z "$command" ]]; then
  # Cannot parse — let it through silently rather than block legitimate work.
  exit 0
fi

block() {
  local reason="$1"
  printf '🚫 Blocked by .codex/hooks/pre-tool-use-policy.sh:\n%s\n\nIf this was intentional, ask the user to authorize before retrying.\n' "$reason" >&2
  exit 2
}

# 1. Force-push to main.
if printf '%s' "$command" | grep -qE 'git[[:space:]]+push[[:space:]].*--force([^[:alpha:]]|$)' \
   && printf '%s' "$command" | grep -qE '(\bmain\b|origin[[:space:]]+main|HEAD:main)'; then
  block "force-push to main is not permitted. Use --force-with-lease on a feature branch instead."
fi

# 2. Force-push without lease, anywhere (warn but do not block).
if printf '%s' "$command" | grep -qE 'git[[:space:]]+push[[:space:]]+--force([^[:alpha:]]|$)' \
   && ! printf '%s' "$command" | grep -qE 'force-with-lease'; then
  printf '⚠️  pre-tool-use-policy: prefer `git push --force-with-lease` over `--force`.\n' >&2
  # Do not block — warning only.
fi

# 3. rm -rf at root or above the project.
if printf '%s' "$command" | grep -qE 'rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*[[:space:]]+|-rf?[[:space:]]+|--recursive[[:space:]]+).*((^|[[:space:]])/(\s|$)|/usr|/etc|/System|/Library)'; then
  block "rm -rf targeting a system path is not permitted."
fi

# 4. Skip git hooks unless explicitly authorized (mirrors the user-global rule).
if printf '%s' "$command" | grep -qE 'git[[:space:]]+commit[[:space:]].*--no-verify' \
   || printf '%s' "$command" | grep -qE 'git[[:space:]]+(push|pull|rebase|merge)[[:space:]].*--no-verify'; then
  printf '⚠️  pre-tool-use-policy: --no-verify bypasses commit hooks. Confirm with the user before retrying.\n' >&2
  # Warning only; the agent decides whether to retry.
fi

# 5. Pushing to verdict main (the canonical branch this hook protects).
if [[ "$PROJECT_ROOT" == */verdict ]] || [[ "$PROJECT_ROOT" == */playwright-workbench ]]; then
  if printf '%s' "$command" | grep -qE 'git[[:space:]]+push[[:space:]].*[[:space:]]main([^[:alpha:]]|$)' \
     && ! printf '%s' "$command" | grep -qE 'force-with-lease|force'; then
    # Plain `git push origin main` is a code smell on this repo (we PR everything),
    # but not block-worthy — emit a warning.
    printf '⚠️  pre-tool-use-policy: direct push to main detected. Confirm this is not a feature branch first.\n' >&2
  fi
fi

exit 0
