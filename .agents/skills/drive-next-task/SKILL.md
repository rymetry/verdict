---
name: drive-next-task
description: Orchestrate one iteration of the autonomy loop. Reads progress checkpoint, picks the next T-task, hands off to Codex, waits for the PR, runs verify-completion, requests Codex review, optionally auto-merges, updates the checkpoint, and loops or exits. Use to drive PLAN.v3 forward without per-task user prompting. The driver is read-write; it modifies branches, opens PRs, and (if AUTONOMY_AUTO_MERGE=true) merges.
---

# Drive one autonomy loop iteration

This is the orchestrator. It composes `pick-next-task`, `execute-t-task` (via Codex), `verify-completion`, `escape-loop`, and `checkpoint-progress`.

## Modes

- **Default (semi-autonomous)**: drives until verify-completion passes; stops at "ready to merge" and surfaces the PR for human merge.
- **Full-autonomy** (`AUTONOMY_AUTO_MERGE=true`): drives through merge as well. Use only when the user explicitly opts in.

## Pre-flight

1. Confirm `node_modules` is bootstrapped (per `AGENTS.md` §4 callout).
2. Confirm `.agents/state/progress.json` exists; if not, run `checkpoint-progress` init.
3. Confirm working tree is clean (`git status --short` returns empty).

If any pre-flight fails, escalate to user; do not proceed.

## Procedure (one iteration)

### Step 1 — checkpoint resume_check

```bash
RESUME=$(jq -r '
  if .escalated | length > 0 then "BLOCKED_ESCALATED"
  elif .active != null then "RESUME_ACTIVE"
  else "READY_FOR_NEXT"
  end
' .agents/state/progress.json)
```

- `BLOCKED_ESCALATED` → exit. Surface "loop is paused, see escape dump".
- `RESUME_ACTIVE` → check whether the active PR has already been merged via `gh pr view <pr_number> --json state --jq .state`. If `MERGED`, call `checkpoint-progress complete_task` and treat this iteration as `READY_FOR_NEXT` (continue to Step 2 to pick the next T-task). Otherwise go to Step 4 (re-verify the existing PR; do not pick a new task).
- `READY_FOR_NEXT` → continue to Step 2.

### Step 2 — pick the task

Invoke `pick-next-task`. Outcomes:
- `STATUS: DONE` → exit. PLAN.v3 is complete.
- `STATUS: BLOCKED <reason>` → wait 10 minutes, then re-run Step 2 (likely a PR is in CI).
- `TID: <T-id> ...` → continue to Step 3.

Run `checkpoint-progress claim_task` with the TID and a derived branch name (`<type>/<TID>-<short-kebab>` per `prepare-release`).

### Step 3 — hand off to Codex

Build a Codex prompt by templating from prior hand-off (e.g. PR #92). The template fills:
- `{TID}`, `{DELIVERABLE}` from `pick-next-task` output
- Required reading list (AGENTS.md, execute-t-task, schema-first, path-safety, no-shell, secret-handling, run-tests; plus the relevant RFC if the row references one)
- In-scope / not-in-scope sections derived from the deliverable column
- Branch / commit / PR conventions
- Pre-PR checklist (per AGENTS.md §4 bootstrap, then schema build, typecheck, test, coverage)

Save the prompt to `.agents/state/codex-prompt-<TID>.md` (kept until task completes for debugging) and invoke:

```bash
codex exec \
  -c 'model="gpt-5.5"' \
  -c 'model_reasoning_effort="high"' \
  --cd "$(pwd)" \
  "$(cat .agents/state/codex-prompt-<TID>.md)" \
  > .agents/state/codex-out-<TID>.log 2>&1
```

`record_codex_call` after invocation.

If `codex exec` exits non-zero, increment failure_counts and go to Step 6.

Codex should produce a PR; extract its number from the output (regex `https://github\.com/[^/]+/[^/]+/pull/(\d+)` from the log) and `record_pr`.

### Step 4 — verify the PR

Invoke `verify-completion` with the PR number and TID.

Outcomes:
- `WAITING` → wait 90s, re-run verify (track via `record_ci_poll`).
- `FAIL` → run `record_failure` and go to Step 6.
- `PASS_WITH_WARNINGS` → log warnings; continue to Step 5 (warnings are advisory).
- `PASS` → continue to Step 5.

### Step 5 — Codex review

```bash
codex review --commit "$(gh pr view <PR_NUMBER> --json commits --jq '.commits[-1].oid')" \
  -c 'model="gpt-5.5"' -c 'model_reasoning_effort="high"' \
  --title "$(gh pr view <PR_NUMBER> --json title --jq '.title')" \
  > .agents/state/codex-review-<TID>.log 2>&1
```

If review finds P0/P1 issues:
- Comment them on the PR for the record.
- If the issues are within the original T-task scope: hand back to Codex with a fix prompt (Step 3 variant). Increment `failure_counts` only if the same issue persists across attempts.
- If the issues are scope-creep (extending T-task): defer to follow-up; do not retry. Mark verify as PASS-with-deferred-followup.

If review is clean → continue to Step 6 (success).

### Step 6 — finalize iteration

Two paths:

**6a. Failure path** (verify FAIL or codex exec failure):
- Check `failure_counts[<TID>]`. If `>= 3` → invoke `escape-loop` and exit.
- Otherwise: leave `active` as-is; the next iteration will retry with the same TID.

**6b. Success path** (verify PASS, review clean):
- Comment "verify-completion: PASS, codex review: clean" on the PR.
- If `AUTONOMY_AUTO_MERGE=true`:
  ```bash
  gh pr merge <PR_NUMBER> --squash --delete-branch
  ```
  Then `complete_task` and continue to Step 1 of the next iteration.
- Otherwise (default): emit "READY_FOR_HUMAN_MERGE" with the PR URL and exit. The next iteration picks up where this one left off when the human merges (Step 1 detects `RESUME_ACTIVE` → checks PR state → if merged, `complete_task` and proceed).

## Output (per iteration)

The driver always emits a structured summary:

```
ITERATION: <n>
TID: <T-id>
PR: #<n> (<URL>)
VERIFY: PASS | PASS_WITH_WARNINGS | FAIL | WAITING
CODEX_REVIEW: clean | issues:<count> | n/a
RESULT: READY_FOR_HUMAN_MERGE | MERGED | RETRYING | ESCALATED | BLOCKED_DONE
NEXT: <what the next iteration would do, or DONE>
```

## Forbidden

- Auto-merging without `AUTONOMY_AUTO_MERGE=true` set.
- Skipping verify-completion ("CI green is enough").
- Continuing past escape-loop without user resume.
- Picking multiple T-tasks per iteration.
- Touching `~/.codex/auth.json` or any secrets file.

## Sample first-run

```bash
# Set explicit auto-merge opt-in (or omit for semi-autonomous mode):
export AUTONOMY_AUTO_MERGE=false

# Initialize state:
mkdir -p .agents/state
[ -f .agents/state/progress.json ] || \
  echo '{"schema_version":1,"started_at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","active":null,"completed":[],"failure_counts":{},"escalated":[],"stats":{"iterations":0,"codex_calls":0,"ci_polls":0},"last_iter_at":null}' \
  > .agents/state/progress.json

# Run one iteration manually (Claude reads this skill, executes the steps):
# In a Claude Code session, invoke:
#   "Run drive-next-task"
# Or set up a /loop or /schedule to run periodically.
```

## Related

- `.agents/skills/pick-next-task/SKILL.md` — Step 2.
- `.agents/skills/checkpoint-progress/SKILL.md` — state mutations.
- `.agents/skills/verify-completion/SKILL.md` — Step 4.
- `.agents/skills/escape-loop/SKILL.md` — Step 6a triggers.
- `.agents/skills/execute-t-task/SKILL.md` — what Codex follows during Step 3.
- `AGENTS.md` §4 — bootstrap reqs that pre-flight enforces.
