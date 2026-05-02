---
name: execute-t-task
description: Use when starting work on a numbered T-task from PLAN.v3 (e.g. T1500-3, T2000-5). Establishes the branch, schema/code/test cadence so a single PR equals a single T-task. Delegates the final pre-PR checklist to `prepare-release`. If no T-task exists for the work, escalate to the user before proceeding.
---

# Execute a T-task from PLAN.v3

A T-task is the unit of PR scope in Verdict. Each PR should map to one T-task, with the task ID surfaced in the branch, commit, and PR title.

## When to use

- The user mentions a T-ID like "T1500-3" or "T2000-5".
- You are starting work that maps to a deliverable in PLAN.v3.md (sections 2-4).
- You need to scope a PR cleanly so reviewers (human + AI) can evaluate one logical change.

If the task is **not** in PLAN.v3, stop and ask the user: should we add it to PLAN.v3 first, or proceed as a one-off `chore:` / `fix:` PR?

## Standard flow

### 1. Locate the T-task in PLAN.v3

```bash
grep -n "T1500-3" docs/product/PLAN.v3.md
```

Read the row to confirm:
- The deliverable (what file path / what behavior).
- The phase ordering — is this gated on a prior task?
- Any RFC or skill referenced in the row.

If the deliverable references an RFC (e.g. `docs/product/rfcs/0001-*`), open it and read the relevant section before writing code.

### 2. Create the branch

```bash
git fetch origin main
git checkout -b feat/T1500-3-exploration-engine origin/main
```

Branch convention: `<type>/<T-id>-<short-kebab-name>`. Type per Conventional Commits.

### 3. Plan the change

Spend 5-10 minutes on a written plan before touching code:

- Files I will create / modify.
- Schema changes in `packages/shared` (these come **first** — see `.agents/rules/schema-first.md`).
- Tests I will add (vitest unit + integration; e2e if user-visible).
- Hooks the change will trigger (typecheck, post-write).

Use `TaskCreate` to track sub-steps if there are 3+. Mark each completed as you go.

### 4. Implement schema-first

Reference `.agents/skills/add-shared-schema/SKILL.md` for the full mechanics. The short version:

1. Update `packages/shared/src/index.ts` with the new Zod schema.
2. `pnpm --filter @pwqa/shared build` so consumers see the new types.
3. Implement agent / web changes that import the new schema.

### 5. Implement + test in lockstep

- Follow `.agents/skills/run-tests/SKILL.md` for test commands.
- TDD where possible (the user-global rule: write the test first, watch it fail, then implement).
- Run `pnpm typecheck` after each substantive change. Type drift caught early is cheap.
- For agent code, exercise the failure paths (timed out, cancelled, exit-non-zero) explicitly.

### 6. Pre-PR self-check

- [ ] All new APIs go through `packages/shared` zod schema?
- [ ] Path-emitting code emits project-relative? See `.agents/rules/path-safety.md`.
- [ ] Subprocess code uses `CommandRunner`? See `.agents/rules/no-shell.md`.
- [ ] No raw secrets logged? See `.agents/rules/secret-handling.md`.
- [ ] Tests cover the new behavior + a failure mode?
- [ ] `pnpm typecheck && pnpm test` green locally?
- [ ] No edits to PLAN.v2.md or IMPLEMENTATION_REPORT.md?

### 7. Commit

```
git commit -m "feat(T1500-3): add exploration engine adapter for Stagehand

Implements the Stagehand-backed Phase A of the multi-stage AI pipeline
(see RFC 0001 sec 4.1). Adds:
  - apps/agent/src/exploration/stagehand.ts
  - packages/shared exploration schema
  - integration test against the sample Allure fixture

Refs: docs/product/PLAN.v3.md sec 2.2 T1500-3"
```

Subject ≤72 chars, body wraps ~78. Reference T-ID in the subject parenthetical and again in the body. `Refs:` line points back to PLAN.v3 for traceability.

### 8. Create the PR

```
gh pr create --base main \
  --title "feat(T1500-3): add Stagehand exploration adapter" \
  --body "$(...)"
```

Use the standard PR body template (see prior PRs #88/#89 for shape):

- **Summary** — 2-3 bullets, what + why.
- **What's in this PR** — files / components / tests touched.
- **Why this design** — rationale, tradeoffs vs alternatives.
- **NOT in this PR** — explicitly defer scope so reviewers do not ask.
- **Test plan** — checkbox list of what was verified, what to verify on merge.
- **Refs** — RFC sections, related T-tasks, prior PRs.

### 9. Wait for CI + review

- CI: `verify` and `gui e2e` must be green. If `gui e2e` is unrelated to your change and fails, escalate to user — do not merge red.
- Review: human + Codex (`codex review --uncommitted` or `gh pr review`). Rounds capped at 3 (see `.agents/skills/run-tests/SKILL.md` for review-loop conventions).

### 10. Merge

`gh pr merge <N> --squash --delete-branch` once approved. The squashed commit becomes the canonical change in `main`.

## Important pitfalls

- **Auto-merge race**: If you push more commits to the PR after enabling auto-merge, the merge may fire before later commits land. Push everything you intend to ship, **then** approve / enable auto-merge. (We hit this with PR #88 — only commit 1 made it to main; commit 2 was lost.)
- **Cross-task drift**: If your T-task touches code that another in-flight PR also touches, surface the conflict to the user. Do not silently rebase over their work.
- **PLAN.v3 changes**: If you have to expand or split the T-task during implementation, update PLAN.v3 in the same PR with a one-line edit so the roadmap matches reality.

## Reference patterns

- `feat:` — new behavior the user can observe.
- `fix:` — bug fix; reference the failing test in the body.
- `refactor:` — no behavior change; tests must still pass green at the same coverage.
- `chore:` — tooling, infra, agent foundation.
- `docs:` — documentation only (PRODUCT, PLAN.v3, RFCs, .agents/).
- `test:` — tests only (added or expanded).
- `perf:` — measured perf change; include before/after numbers in body.
