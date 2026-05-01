#!/usr/bin/env bash
# Pre-tool-use policy for Bash invocations.
#
# Invoked by both Codex (via .codex/config.toml) and Claude Code (via
# .claude/settings.json). Reads the proposed command from stdin as JSON
# and applies a small policy in python (so quoted strings are decoded
# correctly and the regex set is portable across macOS / Linux).
#
# Behavior:
#   exit 0  → allow the tool call
#   exit 2  → block the tool call (the agent receives the stderr message)
#
# What this hook blocks (almost-certainly-a-mistake set):
#   - `git push --force` (without lease) targeting `main`
#   - `rm -rf` targeting filesystem-system roots (/, /usr, /etc, /System, /Library)
#
# What it warns about (does NOT block):
#   - `git push --force` without `--force-with-lease` on any branch
#   - `--no-verify` flags on git commit / push / etc.
#   - direct `git push origin main` with no force flag (PR-only repo norm)
#
# What it does NOT promise:
#   - Generic redirection (`>`, `>>`, heredoc, `tee`) outside the project root.
#     The CommandRunner inside the agent is the right enforcement point for
#     fine-grained filesystem confinement. This hook is a coarse last-mile
#     check at the user shell.

set -uo pipefail

if ! command -v python3 >/dev/null 2>&1; then
  # No python3 — silently allow rather than corner the user.
  exit 0
fi

input="$(cat)"

HOOK_INPUT="$input" python3 - <<'PYEOF'
import json
import os
import re
import sys

def emit_block(reason: str) -> None:
    sys.stderr.write(
        "\U0001F6AB Blocked by .codex/hooks/pre-tool-use-policy.sh:\n"
        f"{reason}\n\n"
        "If this was intentional, ask the user to authorize before retrying.\n"
    )
    sys.exit(2)

def emit_warning(message: str) -> None:
    sys.stderr.write(f"⚠️  pre-tool-use-policy: {message}\n")

raw = os.environ.get("HOOK_INPUT", "")
if not raw.strip():
    sys.exit(0)
try:
    event = json.loads(raw)
except json.JSONDecodeError:
    sys.exit(0)
if not isinstance(event, dict):
    sys.exit(0)

command = None
if isinstance(event.get("command"), str):
    command = event["command"]
else:
    for parent in ("tool_input", "input"):
        sub = event.get(parent)
        if isinstance(sub, dict) and isinstance(sub.get("command"), str):
            command = sub["command"]
            break

if not command:
    sys.exit(0)

cmd = command  # decoded plaintext, no JSON escaping left

# --- Block rules -----------------------------------------------------------

# B1. force-push to main (without --force-with-lease).
push_pattern = re.compile(r"\bgit\s+push\b")
force_pattern = re.compile(r"--force(?!-with-lease)\b")
main_pattern = re.compile(r"(?:\borigin\s+main\b|\bHEAD:main\b|\bmain\b\s*(?:$|;|&&|\|\|))")
if push_pattern.search(cmd) and force_pattern.search(cmd):
    if main_pattern.search(cmd):
        emit_block("force-push to main is not permitted. Use --force-with-lease on a feature branch instead.")

# B2. rm -rf targeting system paths (also: bare /, /usr, /etc, /System, /Library).
rm_pattern = re.compile(
    r"\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*|-rf?|--recursive)(?:\s+-[a-zA-Z]+)*\s+([^\s;&|]+)",
)
DANGER_PATH_PREFIXES = (
    "/",
    "/usr",
    "/etc",
    "/System",
    "/Library",
    "~",
    "/var",
    "/bin",
    "/sbin",
    "/opt",
    "/boot",
    "/home",
    "/root",
)
for match in rm_pattern.finditer(cmd):
    target = match.group(1).strip().strip("'\"")
    if not target:
        continue
    # Bare "/" stays "/"; "/etc/" → "/etc"; "/etc/passwd" stays "/etc/passwd"
    normalized = target if target == "/" else target.rstrip("/")
    if normalized in DANGER_PATH_PREFIXES:
        emit_block(f"rm -rf targeting a system path ({normalized}) is not permitted.")
    # /etc/passwd, /usr/local, etc. — anything UNDER a system root
    for prefix in DANGER_PATH_PREFIXES:
        if prefix == "/":
            continue
        if normalized == prefix or normalized.startswith(prefix + "/"):
            emit_block(f"rm -rf targeting a system path ({normalized}) is not permitted.")

# --- Warn rules ------------------------------------------------------------

# W1. --force without --force-with-lease (any branch).
if push_pattern.search(cmd) and force_pattern.search(cmd):
    emit_warning("prefer `git push --force-with-lease` over `--force`.")

# W2. --no-verify (git commit / push / etc.).
if re.search(r"\bgit\s+(commit|push|merge|rebase|pull)\b.*--no-verify", cmd):
    emit_warning("--no-verify bypasses commit hooks. Confirm with the user before retrying.")

# W3. plain `git push origin main` (this repo lands changes via PR).
if re.search(r"\bgit\s+push\b", cmd) and re.search(r"\bmain\b", cmd):
    if not force_pattern.search(cmd):
        emit_warning("direct push to main detected. Confirm this is not a feature branch first.")

sys.exit(0)
PYEOF
