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
 * an explicit array to **replace** (not extend) the default; this keeps the
 * call site self-documenting about what is enforced.
 *
 * Scope: applies to the `for-of` collection-wide check pattern. Single-entry
 * `errors.find(...).not.toHaveProperty("err")` cases stay inline because
 * extracting them would require a different shape and reduce readability.
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
