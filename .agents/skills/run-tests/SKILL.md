---
name: run-tests
description: Use when running, interpreting, or extending Verdict's test suite. Covers Vitest unit / integration, GUI smoke, full Allure pipeline E2E, and how to scope a fast feedback loop while a feature is in progress.
---

# Run and interpret tests

Verdict has three test layers, each with a distinct purpose and runtime cost.

## Layers

| Layer | Tool | Where | Typical runtime | When to run |
|---|---|---|---|---|
| Unit / Integration | Vitest | `apps/agent/test/`, `apps/web/test/` | 5-15 s scoped, ~1 min full | Every save (scoped); before commit (full) |
| GUI smoke | Playwright via `e2e/` | `e2e/tests/` | ~1-2 min | Before pushing UI-touching PR |
| Allure pipeline E2E | Playwright + Allure | `e2e/tests/` (`smoke:allure`) | ~2-3 min | Before pushing Allure-pipeline-touching PR |

## Daily commands

```bash
# Type-check across the whole monorepo (fast feedback for refactors).
pnpm typecheck

# All unit + integration tests across agent + web.
pnpm test

# Build (rare; mostly to validate dist outputs).
pnpm build

# GUI smoke (starts dev servers, exercises the GUI shell).
pnpm smoke:gui

# Full Allure pipeline E2E (uses sample-pw-allure-project fixture).
pnpm smoke:gui:allure
```

## Scoped fast-loop while developing

When iterating on a single agent file, scope the test run:

```bash
pnpm --filter @pwqa/agent test -- runManager
```

This runs only test files whose path contains `runManager`. Equivalent for web:

```bash
pnpm --filter @pwqa/web test -- run-console
```

The post-write hook (`.codex/hooks/post-tool-use-typecheck.sh`) will already run typecheck for you on save; you usually don't need to invoke it manually.

## Interpreting failures

### Vitest

- A failure is a single test case. The diff is rendered inline; copy the actual vs expected for triage.
- `expect(...).toMatchSnapshot()` failures: validate the new snapshot is what you intended **before** updating with `--update`. Snapshot-by-default is a code-smell when the data has structural meaning.
- `Cannot find module '@pwqa/shared'` after a schema edit: you forgot `pnpm --filter @pwqa/shared build`.

### GUI smoke

- Tests fail with screenshots saved under `e2e/test-results/`.
- Playwright produces `trace.zip` for each failure; open with `pnpm exec playwright show-trace <path>` to step through.
- "Could not find data-testid" → the panel was renamed without updating the test, or the panel was not mounted in the persona route under test.

### Allure pipeline E2E

- The fixture under `tests/fixtures/sample-pw-allure-project/` is the test target.
- `runs/<runId>/` artifacts are kept for inspection; check `metadata.json` and `quality-gate-result.json` first.
- "playwright-report not produced" → the project's `playwright.config.ts` does not have a `json` reporter; the fallback (`materializePlaywrightJsonSafely`) should kick in. If it does not, inspect the `playwrightJsonWarnings`.

## Adding a test

### Vitest unit test

1. Create `<area>.test.ts` next to the source under `apps/agent/test/` or `apps/web/test/`.
2. Use `describe` for the symbol under test, `it` for behaviors. Behavior phrasing: `should <observable behavior>` (English).
3. Cover happy path + at least one failure mode. For path-emitting code, cover the absolute-path-input-becomes-relative-output assertion (see `.agents/rules/path-safety.md`).
4. Mock external dependencies (file system, network) only at the lowest level needed. Real `tmpdir`-based tests are preferred over deep mocks.

### Vitest integration test

For agent tests that exercise multiple modules end-to-end:

- Use `mkdtempSync(path.join(os.tmpdir(), "pwqa-..."))` for an isolated workspace.
- Stub external commands via `unsafelyAllowAnyArgsValidator` policy + a `node` shim script (see `apps/agent/test/runManager.test.ts` for the pattern).
- Always clean up in `afterEach` so the suite is reentrant.

### GUI smoke test

- Use the existing test factory in `e2e/tests/`.
- Drive via `data-testid`. Avoid CSS selectors and text-content asserts where a testid exists.
- Add the new test only if it covers a flow that is visible to the user, not internal behavior (which belongs in a Vitest test).

## Coverage expectation

The user-global rule mandates 80%+ coverage. Concretely for Verdict:

- New agent code: unit + integration tests for the happy path, the most likely failure mode, and any path / secret / shell boundary.
- New web feature: unit / integration tests for loading / empty / error / success states.
- New GUI smoke: only when the path is user-visible and not already covered by a unit or integration test.

Coverage is enforced by the `verify` CI job. PRs that drop coverage below the threshold are flagged.

## Forbidden

- Skipping `it.skip` / `it.todo` without an explicit follow-up T-task in PLAN.v3.
- Calling out to real external services (real GitHub API, real Stripe, real Anthropic) from any test. Mock at the boundary or use the project's MSW layer (when wired).
- Updating snapshots blindly. Inspect the diff first.
- "Flaky" assertions that depend on system timing. Use Playwright's web-first assertions (`toHaveURL`, `toBeVisible`) rather than `waitForTimeout`.

## Related

- `.agents/rules/code-style.md` — what makes a test maintainable.
- `apps/agent/test/runManager.test.ts` — reference for tmpdir-based agent integration tests.
- `apps/web/test/features/run-console.test.tsx` — reference for cancel-button flow tests.
- `e2e/tests/` — reference for GUI smoke fixtures.
