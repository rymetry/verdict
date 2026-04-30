import type { FailedTest, TestResultSummary } from "@pwqa/shared";
import type { ReadSummaryResult } from "./ReportProvider.js";

/**
 * §1.1 Pure merger for multiple `ReadSummaryResult` outputs.
 *
 * Phase 1 sourced `RunMetadata.summary` exclusively from
 * `playwrightJsonReportProvider`. Phase 1.2 introduced
 * `allureReportProvider` (T202) but never wired it into the run pipeline,
 * so Allure-only projects ended up with an empty summary. This module
 * defines the deterministic merge rules; `runManager.readSummariesSafely`
 * is the wired caller (it also owns structured-error logging since the
 * `runId` lives there).
 *
 * Merge rules (PLAN.v2 §16; "Playwright JSON authoritative for counters,
 * Allure augments attachments"):
 *   - Counters (total / passed / failed / skipped / flaky / durationMs):
 *     first input with a non-undefined summary wins. Subsequent results
 *     are used purely for `failedTests` attachment augmentation.
 *   - `failedTests`: identity preserved from the primary; when a secondary
 *     has a matching entry (testId → fullTitle → title), its attachments
 *     are appended iff their `path` is not already present.
 *   - `warnings`: concatenated; provider-name prefix added only when
 *     more than one provider contributed (so single-provider callers see
 *     the same text as Phase 1).
 */

export interface MergeInput {
  provider: string;
  /** `undefined` when the provider returned no data (silent skip). */
  result: ReadSummaryResult | undefined;
  /**
   * Pre-formatted warning string for read failures the caller already
   * structured-logged. Keeps the warning in the user-visible terminal
   * record without re-deriving it here.
   */
  failureWarning?: string;
}

export function mergeReadSummaryResults(
  inputs: ReadonlyArray<MergeInput>
): ReadSummaryResult | undefined {
  const primary = inputs.find((c) => c.result?.summary);
  if (!primary?.result) {
    const warnings = inputs.flatMap((c) => collectWarnings(c, false));
    if (warnings.length === 0) return undefined;
    return { summary: emptySummary(), warnings };
  }

  const secondary = inputs.filter(
    (c) => c !== primary && c.result?.summary
  );

  const mergedFailedTests = mergeFailedTests(
    primary.result.summary.failedTests,
    secondary.flatMap((c) => c.result!.summary.failedTests)
  );

  const summary: TestResultSummary = {
    ...primary.result.summary,
    failedTests: mergedFailedTests,
  };

  const multi = inputs.filter((c) => c.result || c.failureWarning).length > 1;
  const warnings = inputs.flatMap((c) => collectWarnings(c, multi, true));

  return { summary, warnings };
}

function emptySummary(): TestResultSummary {
  return {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    failedTests: [],
  };
}

function collectWarnings(
  captured: MergeInput,
  prefixForMulti: boolean,
  suppressMissingFailures = false
): string[] {
  const suppressFailure =
    suppressMissingFailures &&
    captured.provider === "playwright-json" &&
    captured.failureWarning?.includes("code=ENOENT") === true;
  const fromFailure =
    captured.failureWarning && !suppressFailure
      ? [captured.failureWarning]
      : [];
  const fromProvider = captured.result?.warnings ?? [];
  if (!prefixForMulti) return [...fromFailure, ...fromProvider];
  return [
    ...fromFailure.map((w) => withProviderPrefix(captured.provider, w)),
    ...fromProvider.map((w) => withProviderPrefix(captured.provider, w)),
  ];
}

function withProviderPrefix(provider: string, warning: string): string {
  // Avoid double-prefixing if the provider already prefixed itself.
  if (warning.startsWith(`${provider}:`) || warning.startsWith(`[${provider}]`)) {
    return warning;
  }
  return `[${provider}] ${warning}`;
}

function failedTestCandidateKeys(test: FailedTest): string[] {
  // Primary and secondary providers identify failures with different axes
  // (Playwright JSON often omits testId while Allure emits a uuid). Index
  // by every viable key so a primary lookup hits regardless of which
  // identifier each side has populated. Order matters only for tie-break:
  // testId > fullTitle > title.
  const keys: string[] = [];
  if (test.testId && test.testId.length > 0) keys.push(`id:${test.testId}`);
  if (test.fullTitle && test.fullTitle.length > 0) keys.push(`full:${test.fullTitle}`);
  if (test.title && test.title.length > 0) keys.push(`title:${test.title}`);
  return keys;
}

function mergeFailedTests(
  primary: ReadonlyArray<FailedTest>,
  secondary: ReadonlyArray<FailedTest>
): FailedTest[] {
  // Build an exhaustive key→FailedTest index for secondary entries so a
  // primary's lookup can match by any axis the two providers share.
  const secondaryByKey = new Map<string, FailedTest>();
  for (const test of secondary) {
    for (const key of failedTestCandidateKeys(test)) {
      if (!secondaryByKey.has(key)) {
        secondaryByKey.set(key, test);
      }
    }
  }

  return primary.map((test) => {
    const match = primaryLookup(secondaryByKey, test);
    if (!match || match.attachments.length === 0) return test;

    const existingPaths = new Set(test.attachments.map((a) => a.path));
    const additions = match.attachments.filter((a) => !existingPaths.has(a.path));
    if (additions.length === 0) return test;

    return { ...test, attachments: [...test.attachments, ...additions] };
  });
}

function primaryLookup(
  secondaryByKey: Map<string, FailedTest>,
  test: FailedTest
): FailedTest | undefined {
  for (const key of failedTestCandidateKeys(test)) {
    const match = secondaryByKey.get(key);
    if (match) return match;
  }
  return undefined;
}
