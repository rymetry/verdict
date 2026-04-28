import { expect } from "vitest";

/**
 * Issue #27 / #30: assert that a collection of structured-log payloads does
 * not leak any of the given absolute filesystem paths and that no entry
 * carries a forbidden top-level field. The helper exists because new
 * path-bearing logger call sites can silently regress the redaction
 * guarantees if reviewers miss adding the per-call assertions; centralizing
 * the pattern makes regressions visible in code review (a missing
 * `expectNoPathLeak` line is louder than a missing pair of inline asserts).
 *
 * Default `forbiddenKeys` is `["err"]` — the field that `errorLogFields()`
 * drops by fail-closed default (`apps/agent/src/lib/structuredLog.ts`). Pass
 * an explicit array to **replace** (not extend) the default. Replace
 * semantics is load-bearing, not stylistic: callers like
 * `runManager.test.ts` `forbiddenKeys: ["err", "playwrightJsonPath"]`
 * intentionally re-state `"err"` alongside the route-specific key. An
 * extending API would let a caller write `forbiddenKeys: ["playwrightJsonPath"]`
 * and silently lose the `err` enforcement — replacing forces the caller to
 * type out the full list, which makes drift visible in code review.
 *
 * When to use this helper: asserting over an entire payload **collection**
 * (the `for-of` pattern) — call sites at `runManager.test.ts:395, 1162`.
 * For a single-entry assertion where a `find(...)` predicate already
 * pinpoints one record (e.g. `server.test.ts:510, 578, 812`), prefer
 * inline `expect(entry).not.toHaveProperty(...)` — wrapping a single entry
 * here would require array-wrapping at the call site and obscure intent.
 */
export function expectNoPathLeak(
  payloads: ReadonlyArray<Record<string, unknown>>,
  paths: readonly string[],
  options: { forbiddenKeys?: readonly string[] } = {}
): void {
  const forbiddenKeys = options.forbiddenKeys ?? ["err"];
  const json = JSON.stringify(payloads);
  for (const p of paths) {
    expect(json).not.toContain(p);
  }
  for (const entry of payloads) {
    for (const key of forbiddenKeys) {
      expect(entry).not.toHaveProperty(key);
    }
  }
}
