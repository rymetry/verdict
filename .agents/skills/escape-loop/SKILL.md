---
name: escape-loop
description: Detect when the autonomy loop is stuck on the same T-task and escalate to the user with a diagnostic dump. Triggers when verify-completion has returned FAIL three consecutive times, or when the same Codex hand-off has been retried three times without a merged PR. Stops the autonomy loop and surfaces the failure pattern.
---

# Escape a stuck autonomy loop

This skill is the safety valve. Without it, the autonomy loop can burn unbounded tokens / time retrying the same broken task.

## When to use

- `checkpoint-progress` reports `failure_counts[<TID>] >= 3`.
- A single PR has been pushed-to >3 times in <30 min without verify-completion passing.
- Codex `exec` has crashed / timed out 3 times for the same hand-off.
- The driver detects a "same error 3x in a row" pattern (string-match on the most recent failure messages).

## Procedure

### 1. Confirm the trigger

Read `.agents/state/progress.json` and verify `failure_counts[<TID>]` is the source of the trigger. If failure count is <3, do nothing (false alarm).

### 2. Collect the diagnostic dump

For the failing T-task, gather:

```bash
TID=<T-id>
PR=<PR_NUMBER from checkpoint, if any>

# Last 3 attempts: their commits, CI results, verify outputs.
{
  echo "## TID: $TID"
  echo "## Failure count: 3"
  echo
  echo "### Last 3 verify-completion outputs"
  cat .agents/state/last-verify-1.log
  cat .agents/state/last-verify-2.log
  cat .agents/state/last-verify-3.log
  echo
  echo "### Open PR"
  gh pr view $PR --json title,statusCheckRollup,commits 2>/dev/null
  echo
  echo "### Last 3 commits on the branch"
  gh pr view $PR --json commits --jq '.commits | .[-3:] | .[].messageHeadline' 2>/dev/null
} > .agents/state/escape-dump-$TID.md
```

### 3. Pattern-classify the failure

Run the dump against these classes (string-match on verify outputs):

- `RECURRING_CI_FAILURE` — same CI check failing three times. Escalation: report which job, link to its log.
- `RECURRING_TYPE_ERROR` — `Cannot find` / `Type ... is not assignable` repeated. Escalation: suggest `pnpm --filter @pwqa/shared build` was missed, OR a real type error.
- `RECURRING_SCOPE_VIOLATION` — verify `CHECK_SCOPE` failing repeatedly. Escalation: T-task scope was misjudged at hand-off; prompt rewrite needed.
- `CODEX_HANG` — Codex exec terminated without producing output. Escalation: model / sandbox / network issue, retry tomorrow.
- `UNCLASSIFIED` — falls through. Escalation: generic.

### 4. Stop the loop

```bash
# Mark the T-task as escalated; do not auto-retry.
jq '.escalated = (.escalated // []) + [{"tid": "'$TID'", "at": now, "class": "<from step 3>"}]' \
  .agents/state/progress.json > .agents/state/progress.tmp.json && \
  mv .agents/state/progress.tmp.json .agents/state/progress.json
```

### 5. Surface to user

Emit (to stdout / Claude conversation):

```
🛑 AUTONOMY LOOP ESCALATED

TID: <T-id>
Class: <RECURRING_CI_FAILURE | RECURRING_TYPE_ERROR | RECURRING_SCOPE_VIOLATION | CODEX_HANG | UNCLASSIFIED>
Failure count: 3
Open PR: #<n>

Diagnostic dump: .agents/state/escape-dump-<TID>.md

Suggested next action:
<one-line concrete recommendation per class>

The autonomy loop has been paused. Resume with:
  rm .agents/state/escape-dump-<TID>.md
  jq '.escalated = [.escalated[] | select(.tid != "<TID>")] | .failure_counts."<TID>" = 0' \
    .agents/state/progress.json > .agents/state/progress.tmp.json && \
    mv .agents/state/progress.tmp.json .agents/state/progress.json
```

## Forbidden

- Triggering on count <3 ("might as well bail early"). The threshold is part of the contract.
- Auto-fixing the failing T-task by editing its PR. That violates "loop is read-only at escalation time".
- Skipping the diagnostic dump. The dump is the user's debugging context.
- Continuing to the next T-task after escalation. The whole loop stops; the user resumes it explicitly.

## Resume contract

The user resumes by:
1. Reading the diagnostic dump.
2. Either fixing the underlying issue (rewriting the hand-off prompt, fixing the test, etc.) or marking the T-task as deferred in PLAN.v3.
3. Resetting `failure_counts[<TID>]` and `escalated[]` in `.agents/state/progress.json`.
4. Restarting the driver.

The skill does NOT auto-resume on its own. Escalation requires human acknowledgment.

## Related

- `.agents/skills/drive-next-task/SKILL.md` — checks this skill's stop signal.
- `.agents/skills/checkpoint-progress/SKILL.md` — owns the `failure_counts` and `escalated` fields.
- `.agents/skills/verify-completion/SKILL.md` — the failure source.
