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
gh pr view <PR_NUMBER> --json statusCheckRollup \
  --jq '.statusCheckRollup[] | select(.status == "COMPLETED") | {name, conclusion}'
```

Pass: every required check `conclusion == "SUCCESS"` or `"SKIPPED"`. Fail: any `FAILURE`, `CANCELLED`, `TIMED_OUT`. In-progress: report `WAITING` and exit (do not call this PR done yet).

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
gh pr diff <PR_NUMBER> | grep -E '\+.*child_process|exec\(.*\)|spawn\(.*\)|execSync|spawnSync' || true
```

Pass: no matches in added lines (lines starting with `+`). Fail: report each line. (CommandRunner usage is fine; it never appears as a literal child_process import in the consumer.)

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
