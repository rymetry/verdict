---
name: checkpoint-progress
description: Read and write the autonomy loop's progress state at `.agents/state/progress.json`. Tracks active T-task, active PR, completed tasks, per-task failure counts, and escalation flags. Use to resume an interrupted loop, update progress between iterations, or inspect what the loop has accomplished.
---

# Manage autonomy loop progress state

This skill is the persistence layer for the autonomy loop. State lives at `.agents/state/progress.json` and is **gitignored** — it is per-machine, per-session.

## State schema

```json
{
  "schema_version": 1,
  "started_at": "2026-05-02T13:45:00Z",
  "last_iter_at": "2026-05-02T15:12:00Z",
  "active": {
    "tid": "T1500-3",
    "pr_number": 94,
    "branch": "feat/T1500-3-exploration",
    "started_at": "2026-05-02T15:00:00Z",
    "last_codex_attempt_at": "2026-05-02T15:08:00Z"
  },
  "completed": ["T1500-1", "T1500-2"],
  "failure_counts": {
    "T1500-3": 1
  },
  "escalated": [],
  "stats": {
    "iterations": 4,
    "codex_calls": 6,
    "ci_polls": 12
  }
}
```

`active` is `null` when the loop is between tasks. `completed` is append-only.

## Operations

### init — first-time setup

If `.agents/state/progress.json` does not exist:

```bash
mkdir -p .agents/state
cat > .agents/state/progress.json <<'EOF'
{
  "schema_version": 1,
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "last_iter_at": null,
  "active": null,
  "completed": [],
  "failure_counts": {},
  "escalated": [],
  "stats": {"iterations": 0, "codex_calls": 0, "ci_polls": 0}
}
EOF
```

### read — get current state

```bash
jq '.' .agents/state/progress.json
```

### claim_task — mark a T-task as active

```bash
TID=<T-id>
BRANCH=<branch>
jq --arg tid "$TID" --arg branch "$BRANCH" --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  .active = {
    tid: $tid,
    pr_number: null,
    branch: $branch,
    started_at: $now,
    last_codex_attempt_at: $now
  } |
  .last_iter_at = $now |
  .stats.iterations += 1
' .agents/state/progress.json > .agents/state/progress.tmp.json && \
  mv .agents/state/progress.tmp.json .agents/state/progress.json
```

### record_pr — attach the PR number

```bash
PR=<n>
jq --argjson pr "$PR" '.active.pr_number = $pr' \
  .agents/state/progress.json > .agents/state/progress.tmp.json && \
  mv .agents/state/progress.tmp.json .agents/state/progress.json
```

### record_failure — increment failure count

```bash
TID=<T-id>
jq --arg tid "$TID" '.failure_counts[$tid] = ((.failure_counts[$tid] // 0) + 1)' \
  .agents/state/progress.json > .agents/state/progress.tmp.json && \
  mv .agents/state/progress.tmp.json .agents/state/progress.json
```

### complete_task — mark active T-task as merged

```bash
TID=<T-id>
jq --arg tid "$TID" --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  .completed = (.completed + [$tid] | unique) |
  .failure_counts[$tid] = 0 |
  .active = null |
  .last_iter_at = $now
' .agents/state/progress.json > .agents/state/progress.tmp.json && \
  mv .agents/state/progress.tmp.json .agents/state/progress.json
```

### record_codex_call / record_ci_poll — stats

```bash
jq '.stats.codex_calls += 1' .agents/state/progress.json > .agents/state/progress.tmp.json && \
  mv .agents/state/progress.tmp.json .agents/state/progress.json
# similar for ci_polls
```

### resume_check — should the loop start a new iteration?

```bash
jq '
  if .escalated | length > 0 then "BLOCKED_ESCALATED"
  elif .active != null then "RESUME_ACTIVE"
  else "READY_FOR_NEXT"
  end
' .agents/state/progress.json
```

The driver branches on the result:
- `BLOCKED_ESCALATED` — the loop is paused; require user intervention.
- `RESUME_ACTIVE` — there's an unfinished task; check its PR status before picking new.
- `READY_FOR_NEXT` — pick-next-task and start fresh.

## Forbidden

- Editing `progress.json` by hand mid-loop. Use the operations above.
- Deleting completed entries. The list is append-only; if a T-task is rolled back via revert, surface a new sub-task in PLAN.v3 instead.
- Storing secrets / tokens / paths in `progress.json`. State is debug-readable.
- Committing `progress.json` to git. Keep it gitignored.

## Inspecting

```bash
# What's currently in flight?
jq '.active' .agents/state/progress.json

# How many T-tasks done?
jq '.completed | length' .agents/state/progress.json

# Has anything been escalated?
jq '.escalated' .agents/state/progress.json
```

## Related

- `.agents/skills/drive-next-task/SKILL.md` — the only routine writer of this state.
- `.agents/skills/escape-loop/SKILL.md` — appends to `escalated`.
- `.gitignore` — must include `.agents/state/`.
