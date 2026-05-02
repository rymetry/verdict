---
name: verify-completion
description: Run automated checks against a T-task PR before claiming it is ready to merge. Validates CI status, coverage, scope discipline, schema-first ordering, conventional commit format, and PR description completeness. Returns a structured pass/fail per check plus an overall verdict. Use after Codex opens a PR and before requesting human / Codex review.
---

# Verify a T-task PR is complete

This skill replaces "human reads the diff and goes 'looks good'" with a deterministic checklist. It does not mutate the PR. It returns a verdict the driver can act on.

## When to use

- Driver has just received a PR URL from Codex's hand-off.
- Before asking for Codex review (avoids burning Codex tokens on a PR that will fail basic checks).
- Before any auto-merge action.

## Inputs

```
PR_NUMBER: <integer>
TID: <T-id from pick-next-task>
EXPECTED_SCOPE: <comma-separated path prefixes, optional>
```

`EXPECTED_SCOPE` defaults are derived from the PLAN.v3 row's "deliverable" column if not supplied (e.g., `T1500-3` → `apps/agent/src/exploration/`).

## Checks (run all, do not stop at first failure)

### CHECK_CI — CI is green

```bash
gh pr view <PR_NUMBER> --json statusCheckRollup --jq '
  .statusCheckRollup[] |
  if .__typename == "StatusContext" then
    {
      name: .context,
      status: (if .state == "PENDING" or .state == "EXPECTED" then "IN_PROGRESS" else "COMPLETED" end),
      conclusion: (if .state == "SUCCESS" then "SUCCESS"
                   elif .state == "FAILURE" or .state == "ERROR" then "FAILURE"
                   else null end)
    }
  else
    {name: .name, status: .status, conclusion: .conclusion}
  end'
```

The jq normalizes both `CheckRun` (GitHub Actions) and `StatusContext` (legacy commit-status) shapes before applying the rule, since the rollup mixes both. CheckRun exposes `status` / `conclusion`; StatusContext only exposes `state` (`SUCCESS` / `FAILURE` / `ERROR` / `PENDING` / `EXPECTED`). After normalization:

- **WAITING** if any normalized entry has `status != "COMPLETED"` (e.g., `IN_PROGRESS`, `QUEUED`, `PENDING`, `WAITING`). Re-run later; do not advance.
- **FAIL** if any entry has `conclusion` in `{FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED, STARTUP_FAILURE}`.
- **PASS** only when every entry has `status == "COMPLETED"` AND `conclusion` in `{SUCCESS, SKIPPED, NEUTRAL}`.

### CHECK_TID_IN_TITLE — PR title contains T-id

```bash
gh pr view <PR_NUMBER> --json title --jq '.title'
```

Title must match `^(feat|fix|chore|refactor|docs|test|perf|ci|build|style)(\([^)]*<TID>[^)]*\))?: .+`. Pass if the T-id appears in the parenthetical. Fail otherwise.

### CHECK_COMMIT_FORMAT — Conventional Commits

```bash
gh pr view <PR_NUMBER> --json commits --jq '.commits[].messageHeadline'
```

Each commit headline must match Conventional Commits + ≤72 chars. The squashed merge will use the PR title, but per-commit hygiene is still surfaced.

### CHECK_SCOPE — diff stays inside expected scope

```bash
gh pr diff <PR_NUMBER> --name-only
```

For each file, verify it starts with one of `EXPECTED_SCOPE` prefixes OR is in the universally-allowed scope set (`packages/shared/src/**` for schema-first additions, `apps/agent/test/**` and `apps/web/test/**` for tests). Out-of-scope files: list them. Fail if any is found.

Forbidden out-of-scope (always fail if touched):
- `PLAN.v2.md`, `IMPLEMENTATION_REPORT.md`
- `LICENSE`
- `.github/workflows/**` (unless TID is a CI-related task)
- Anything under `~/`

### CHECK_SCHEMA_FIRST — schema-first ordering

If the diff touches `apps/agent/src/routes/**` OR `apps/agent/src/events/**` OR `apps/web/src/api/**`:
- The diff MUST also touch `packages/shared/src/**`.
- The shared schema commit (or hunk) must precede the consumer hunks logically (commit order if multi-commit; not enforceable on squash but the diff containing both is the test).

Pass: shared changes present. Fail with diagnostic: "boundary code touched without packages/shared/ change".

### CHECK_NO_SHELL — no `child_process` calls

```bash
# (a) child_process / exec / spawn in production code (test paths exempt — see no-shell.md)
gh pr diff <PR_NUMBER> | awk '
  /^diff --git / {
    isCode = ($0 ~ /\.(ts|tsx|js|jsx|mjs|cjs)$/)
    inTest = ($0 ~ /\/(apps\/agent\/test|apps\/web\/test)\//)
  }
  isCode && !inTest
' | grep -E '^\+.*(\bchild_process\b|\b(execSync|spawnSync|exec|spawn)[ \t]*[(])' || true

# (b) shell-mode option in code anywhere (test paths NOT exempt — shell: true is always forbidden)
gh pr diff <PR_NUMBER> | awk '
  /^diff --git / { isCode = ($0 ~ /\.(ts|tsx|js|jsx|mjs|cjs)$/) }
  isCode
' | grep -E '^\+.*\b["'"'"']?shell["'"'"']?[ \t]*:[ \t]*true\b' || true
```

Pass: both grep commands emit nothing. Fail: any output from either command, reported per matching line. Each pipeline has an awk pre-filter that keeps only code files (`.ts` / `.tsx` / `.js` / `.jsx` / `.mjs` / `.cjs`) so that prose / markdown / config additions never cause CHECK_NO_SHELL to fail; this includes documentation that legitimately mentions `shell: true` as a forbidden literal (such as this skill itself). The asymmetric scope of `.agents/rules/no-shell.md` is then enforced:

1. **(a) production-path check** — `.agents/rules/no-shell.md:50` permits `child_process` imports under `apps/agent/test/` for stub harnesses, so the awk filter additionally strips diff hunks for `apps/agent/test/**` and `apps/web/test/**`. The grep anchors the alternation to added lines (`^\+`). The first inner alternative `\bchild_process\b` catches `import { spawn as rawSpawn } from "node:child_process"` and `require("node:child_process")` — any reference to the module by name, even when functions are imported under aliases. The second alternative `\b(execSync|spawnSync|exec|spawn)[ \t]*[(]` catches direct call sites; `\b` word boundaries plus `[ \t]*[(]` (character class instead of a literal paren) prevent false positives like `runtimeExec(`.

2. **(b) shell-mode check** — `shell: true` is forbidden everywhere code runs, including test harnesses; only the file-extension filter applies. Optional `["']?` around the key catches `{ "shell": true }` and `{ 'shell': true }` (valid JS/TS object-literal forms) in addition to the unquoted shorthand.

CommandRunner usage is fine; it never appears as a literal `child_process` import in the consumer.

### CHECK_PATH_SAFETY — emit relative paths

For files under `apps/agent/src/routes/**`, `apps/agent/src/ai/**`, `apps/web/src/**`:
- Search for `path.resolve(`, `os.tmpdir(`, `process.cwd(`, `__dirname` in returned values or error messages.
- Stub: this is heuristic; flag suspicious patterns for human review rather than auto-fail. Use `WARN_PATH_SAFETY` not `FAIL`.

### CHECK_PR_BODY — required sections present

```bash
gh pr view <PR_NUMBER> --json body --jq '.body'
```

Body must contain headers: `## Summary`, `## What's in this PR`, `## NOT in this PR`, `## Test plan`, `## Refs`. Missing any → fail.

### CHECK_COVERAGE_MENTION — coverage reported in body

PR body should contain a line matching `coverage` (case-insensitive) with a number ≥80, OR an explicit "coverage N/A — only doc/config" justification. Fail if neither.

## Output format

```
VERIFY: T1500-3 PR #92
================================
CHECK_CI                 : PASS
CHECK_TID_IN_TITLE       : PASS
CHECK_COMMIT_FORMAT      : PASS
CHECK_SCOPE              : PASS
CHECK_SCHEMA_FIRST       : PASS
CHECK_NO_SHELL           : PASS
CHECK_PATH_SAFETY        : WARN (1 suspicious pattern; see notes)
CHECK_PR_BODY            : PASS
CHECK_COVERAGE_MENTION   : PASS

VERDICT: PASS_WITH_WARNINGS
NOTES:
- CHECK_PATH_SAFETY: apps/agent/src/exploration/stagehand.ts:42 emits path via path.resolve;
  may be internal-only — review.
```

Verdict values:
- `PASS` — all checks PASS.
- `PASS_WITH_WARNINGS` — only WARN-level issues.
- `FAIL` — at least one FAIL-level check.
- `WAITING` — CI still in progress; rerun verify-completion later.

## When to retry vs escalate

- `WAITING`: poll again every 60–120s (driver's responsibility).
- `FAIL` count for the same TID: increment via `checkpoint-progress`. At 3 → invoke `escape-loop`.
- `PASS_WITH_WARNINGS`: surface to user but do not block; auto-merge is still gated by Codex review.

## Forbidden

- Modifying the PR (commenting/merging) from inside this skill. This skill is read-only.
- Skipping a check because "it'll probably be fine".
- Treating SKIPPED CI checks as FAIL (they're often advisory; `dependabot-auto-merge` SKIPPED is normal).

## Related

- `.agents/skills/drive-next-task/SKILL.md` — calls this after each Codex hand-off.
- `.agents/skills/escape-loop/SKILL.md` — invoked when this skill returns FAIL three times.
- `.agents/skills/prepare-release/SKILL.md` — the human-side checklist this skill mechanizes.
