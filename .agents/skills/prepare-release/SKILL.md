---
name: prepare-release
description: Use as the final pass before opening, pushing, or merging a PR — applies whether the work is a T-task (called from `execute-t-task` step 7+) or a one-off commit. Defines the pre-PR / pre-commit checklist, Conventional Commit format, and PR description template.
---

# Prepare a release-ready commit and PR

A "release-ready" PR is one that can be merged with minimal cleanup: CI is green, conventions are honored, the description is complete enough that a reviewer (human or AI) can approve in one pass.

## When to use

- You are wrapping up a T-task and ready to open a PR.
- You are revising an existing PR after review and want to confirm cleanup is complete.
- You want a final pass before requesting review.

## Pre-commit checklist

Run these in order. Stop at the first failure.

```bash
# 1. Type drift
pnpm typecheck

# 2. Tests
pnpm test

# 3. (If touching the GUI) Smoke
pnpm smoke:gui

# 4. (If touching the Allure pipeline) Full E2E
pnpm smoke:gui:allure

# 5. Diff review
git diff main..HEAD --stat
```

Then:

- [ ] Did I touch `PLAN.v2.md` or `IMPLEMENTATION_REPORT.md`? If yes, **stop** and revert. Use PLAN.v3 / a new RFC instead.
- [ ] Did I add a new convention without an entry in `.agents/rules/` or `.agents/skills/`?
- [ ] Did I add a new env var without documenting it in `docs/operations/poc-guide.md`?
- [ ] Did I emit any absolute path to an external surface? See `.agents/rules/path-safety.md`.
- [ ] Did I introduce a new subprocess that bypasses `CommandRunner`? See `.agents/rules/no-shell.md`.
- [ ] Did I add a new boundary type without going through `packages/shared`? See `.agents/rules/schema-first.md`.
- [ ] Are the tests covering happy + at least one failure mode?

## Commit format

Conventional Commits, T-task ID in the parenthetical:

```
feat(T1500-3): add Stagehand exploration adapter

Implements Phase A of the multi-stage pipeline (RFC 0001 sec 4.1).

- apps/agent/src/exploration/stagehand.ts — adapter implementation
- packages/shared exploration schema — new ScreenModel + ExploredStep
- apps/agent/test/exploration.test.ts — happy path + 2 failure modes

Refs: docs/product/PLAN.v3.md sec 2.2 T1500-3
```

Conventions:
- Subject ≤ 72 chars; imperative.
- Body wraps at ~78 chars. Hard wrap.
- Body lists what changed (files / behaviors), not why (the PR description carries why).
- `Refs:` line for traceability.
- Co-author lines disabled per `~/.claude/settings.json` global. Do not add unless the user re-enables.

## PR description template

```markdown
## Summary

<2-3 bullets: what this PR does, in user-observable terms>

## What's in this PR

- File / component / test changes, organized by area.

## Why this design

<Rationale. Tradeoffs vs alternatives. Reference RFC sections when applicable.>

## NOT in this PR (intentional)

<Explicitly defer scope. Prevent reviewer scope-creep questions.>

## Test plan

- [ ] CI green (verify + gui smoke as applicable)
- [ ] Manually verified <X> in <environment>
- [ ] (Add anything reviewers should reproduce themselves.)

## Refs

- PLAN.v3 sec X.Y (T-task definition)
- RFC NNNN sec X (design spec)
- Prior PR #N (related context)
```

## Push and open the PR

```bash
git push -u origin <branch>
gh pr create --base main --title "<commit subject>" --body "$(cat <<'EOF'
... PR description here ...
EOF
)"
```

If the user wants to use auto-merge:
- **Push all intended commits first.** Auto-merge can fire when CI passes; later commits push to the PR but may not be picked up by the squash. Confirm `gh pr view <N> --json mergedAt` after enabling.
- See PR #88 history for the regression: only commit 1 was squashed; commit 2 (license + brand) was lost. PR #89 had to recover.

## Pre-merge checks

After CI is green and reviewers have approved:

- [ ] PR title still matches the squashed commit subject you want on `main`.
- [ ] PR body was edited if scope changed during review (do not let scope drift go undocumented).
- [ ] No `WIP` / `Draft` markers remain.
- [ ] `gh pr view <N> --json mergeable,mergeStateStatus` returns `MERGEABLE`.

## Post-merge

```bash
gh pr merge <N> --squash --delete-branch
```

Then verify:

```bash
gh pr view <N> --json state,mergedAt,mergeCommit
```

If the squashed commit is missing later commits, the auto-merge race bit you. The recovery is to cherry-pick the missing commits onto a new branch (see PR #89 for the canonical fix).

## Forbidden

- `git push --force` to `main` (always; no exceptions without explicit user authorization).
- `git push --force-with-lease` on `main` (likewise — only on PR branches).
- Merging with red CI by skipping required checks.
- Editing the PR description after merge to retcon what was reviewed.
- `gh pr merge --admin` to bypass branch protection without explicit user authorization.

## Related

- `.agents/skills/execute-t-task/SKILL.md` — the upstream flow that produces a release-ready PR.
- `.agents/skills/run-tests/SKILL.md` — what to run before pushing.
- `.agents/rules/documentation-policy.md` — what files are off-limits for edits.
