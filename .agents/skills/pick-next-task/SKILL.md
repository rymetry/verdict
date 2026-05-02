---
name: pick-next-task
description: Read PLAN.v3, the merged-commit history on main, and open PRs to determine the next unblocked T-task. Returns one T-task brief or NONE if all tasks are complete or blocked. Use as the first step of an autonomous loop iteration, or whenever the user asks "what's next?" without specifying a task.
---

# Pick the next T-task

This skill is the entry point of the autonomy loop. It analyzes project state and returns exactly one of:
- A T-task brief that is ready to be picked up.
- `STATUS: DONE` when all in-scope T-tasks have shipped.
- `STATUS: BLOCKED <reason>` when every candidate is gated on someone else's work.

The skill performs no mutations. It only reads.

## When to use

- An autonomy loop starts a new iteration.
- The user asks "what's next?" / "what should I work on?" without naming a T-task.
- After merging a T-task PR, to determine the follow-up.

## Procedure

### 1. Determine scope from PLAN.v3 §2.3 (waves)

Phase 1.5 wave map (read `docs/product/PLAN.v3.md` lines around §2.3 if changed):

```
α (Foundation)  : T1500-1, T1500-2, T1500-8
β (Exploration) : T1500-3, T1500-4, T1500-5, T1500-6   # gated on α
γ (UX)          : T1500-7, T1500-9                      # gated on β
δ (Ecosystem)   : T1500-10                              # gated on γ

Phase 2         : T2000-1..8                            # gated on Phase 1.5 complete
Phase 3         : T3000-1..10                           # gated on Phase 2 complete
```

Within a wave, prefer the lowest numbered T-task that is unblocked.

### 2. List completed T-tasks

```bash
git fetch origin main
git log origin/main --oneline | grep -oE 'T[0-9]{4}-[0-9]+' | sort -u
```

These are off the candidate list.

### 3. List in-flight T-tasks (open PRs)

```bash
gh pr list --base main --state open --json number,title \
  --jq '.[] | select(.title | test("T[0-9]{4}-[0-9]+")) | {number, tid: (.title | capture("T(?<n>[0-9]{4}-[0-9]+)").n)}'
```

These count as "in-flight". A T-task with an open PR is not eligible to be picked again.

### 4. Determine the active wave

Active wave = the lowest wave that still has incomplete T-tasks. Cannot advance to the next wave until ALL T-tasks in the current wave are merged.

### 5. Pick the candidate

Within the active wave, pick the lowest-numbered T-task that is:
- Not in completed.
- Not in in-flight.
- Has no unmet intra-wave prerequisite (rare; PLAN.v3 §2.3 calls these out explicitly when they exist).

If no such candidate exists, the wave is fully in-flight (waiting for PRs to merge) → return `STATUS: BLOCKED waiting for in-flight PRs`.

### 6. Build the brief

Read the T-task row from PLAN.v3 §2.2 (Phase 1.5), §3.2 (Phase 2), or §4.2 (Phase 3) and emit:

```
TID: T1500-3
DELIVERABLE: Exploration Engine (Stagehand / Browser Use adapter) | apps/agent/src/exploration/ (新規)
PHASE: 1.5-β
WAVE: β (Exploration)
RFC_REF: docs/product/rfcs/0001-workbench-directory.md (sections referenced in row, if any)
PLAN_REF: docs/product/PLAN.v3.md sec 2.2 T1500-3
DEPENDENCIES: T1500-1, T1500-2 (both merged on main)
NOTES: <anything from PLAN.v3 §2.3 ordering text that constrains this task>
```

If the row is ambiguous (e.g. references RFC sections that don't exist), include `AMBIGUITY: <description>` so the driver can decide whether to escalate.

## Output format

Always one of:

```
TID: <T-id>
DELIVERABLE: <row text>
PHASE: <1.5-α | 1.5-β | 1.5-γ | 1.5-δ | 2 | 3>
WAVE: <wave letter or phase>
RFC_REF: <path or NONE>
PLAN_REF: <path>
DEPENDENCIES: <comma-separated T-ids, all marked merged>
NOTES: <free text>
[AMBIGUITY: <text>]
```

Or:

```
STATUS: DONE
```

Or:

```
STATUS: BLOCKED
REASON: <which wave is in-flight, which PR numbers are pending>
```

## Forbidden

- Inventing T-IDs not in PLAN.v3.
- Skipping a wave when the prior wave is incomplete.
- Picking a T-task whose PR is open (would create a duplicate).
- Returning multiple candidates. The autonomy loop is one-T-at-a-time by design.

## Related

- `.agents/skills/drive-next-task/SKILL.md` — the orchestrator that calls this skill.
- `.agents/skills/checkpoint-progress/SKILL.md` — persists the picked T-id between iterations.
- `.agents/skills/execute-t-task/SKILL.md` — the implementation flow Codex runs after pick.
