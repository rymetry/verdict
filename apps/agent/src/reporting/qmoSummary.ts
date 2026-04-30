import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  CommandTemplate,
  QmoSummary,
  QmoSummaryOutcome,
  QualityGateResult,
  RunMetadata,
  TestResultSummary
} from "@pwqa/shared";

/**
 * Phase 1.2 / T207: QMO Release Readiness Summary v0.
 *
 * Pure-function summary generator that combines existing artifacts
 * (RunMetadata + QualityGateResult) into the human-readable
 * `QmoSummary` shape. No I/O or subprocess work — separate from
 * persistence so the derivation logic is unit-testable.
 *
 * Outcome derivation rules (PLAN.v2 §27):
 *   - "not-ready": any failed test OR quality gate failed/error
 *   - "conditional": all tests passed AND quality gate has warnings
 *     or was unable to run (skipped due to missing CLI / no results)
 *   - "ready": all tests passed AND quality gate passed (or
 *     legitimately skipped because Allure is not configured AT ALL)
 *
 * The "skipped" disambiguation for `ready` vs `conditional` uses the
 * presence of a quality gate result: if QG was attempted but returned
 * "skipped" with warnings (binary-missing during a run that DID copy
 * results), treat as conditional. If QG was never attempted (project
 * not Allure-configured), `qualityGateResult` is undefined and the
 * outcome is `ready` based on tests alone.
 */

export interface BuildQmoSummaryInput {
  /** The completed run metadata. Source of truth for runId / projectId
   *  / command / paths / warnings / test summary. */
  runMetadata: RunMetadata;
  /** The persisted Quality Gate result, when one was produced. When
   *  undefined the project either does not use Allure or the QG step
   *  was skipped (e.g. allureRunner not wired in test environments). */
  qualityGateResult?: QualityGateResult;
  /** File-system-backed artifact availability used to avoid stale links. */
  artifactAvailability?: {
    allureReport?: boolean;
    qualityGateResult?: boolean;
  };
}

/**
 * QMO summary generation is pure; real artifact existence is checked by
 * RunManager and injected through `artifactAvailability`. Defaulting to
 * false keeps test-only callers from accidentally emitting links to files
 * that were never observed on disk.
 */
export function buildQmoSummary(input: BuildQmoSummaryInput): QmoSummary {
  const { runMetadata, qualityGateResult, artifactAvailability } = input;
  const testSummary = runMetadata.summary;
  const outcome = deriveOutcome(testSummary, qualityGateResult);
  const allureReportPresent = artifactAvailability?.allureReport === true;
  const qgPresent =
    qualityGateResult !== undefined && artifactAvailability?.qualityGateResult === true;
  return {
    runId: runMetadata.runId,
    projectId: runMetadata.projectId,
    generatedAt: new Date().toISOString(),
    outcome,
    testSummary,
    qualityGate: qualityGateResult
      ? {
          status: qualityGateResult.status,
          profile: qualityGateResult.profile,
          exitCode: qualityGateResult.exitCode,
          warnings: qualityGateResult.warnings
        }
      : undefined,
    warnings: runMetadata.warnings,
    reportLinks: {
      // Only populate links to artifacts that RunManager confirmed on disk.
      allureReportDir: allureReportPresent ? runMetadata.paths.allureReportDir : undefined,
      qualityGateResultPath: qgPresent ? runMetadata.paths.qualityGateResultPath : undefined
    },
    runDurationMs: runMetadata.durationMs,
    command: runMetadata.command
  };
}

function deriveOutcome(
  testSummary: TestResultSummary | undefined,
  qualityGate: QualityGateResult | undefined
): QmoSummaryOutcome {
  // Failed tests dominate everything else — if a test failed the run is
  // definitively not ready, regardless of QG.
  if ((testSummary?.failed ?? 0) > 0) return "not-ready";
  // QG failed / errored → not ready.
  if (qualityGate?.status === "failed" || qualityGate?.status === "error") {
    return "not-ready";
  }
  // QG was attempted but skipped (binary missing during a run with
  // results) OR has warnings → conditional.
  if (qualityGate?.status === "skipped" && qualityGate.warnings.length > 0) {
    return "conditional";
  }
  if ((qualityGate?.warnings.length ?? 0) > 0) {
    return "conditional";
  }
  // All clear: tests passed and QG passed (or was never attempted).
  return "ready";
}

/**
 * Renders the QMO summary as Markdown. Stable, deterministic format
 * — generates the same output for the same input so test snapshots
 * remain reliable.
 *
 * Format (v0):
 *   # QMO Release Readiness Summary
 *   - Outcome: <ready|conditional|not-ready>
 *   - Run: <runId>
 *   - Project: <projectId>
 *   - Generated: <iso>
 *
 *   ## Test Summary
 *   ...
 *
 *   ## Quality Gate
 *   ...
 *
 *   ## Warnings
 *   ...
 *
 *   ## Artifacts
 *   ...
 */
export function renderQmoSummaryMarkdown(summary: QmoSummary): string {
  const lines: string[] = [];
  lines.push("# QMO Release Readiness Summary");
  lines.push("");
  lines.push(`- **Outcome**: \`${summary.outcome}\``);
  lines.push(`- **Run**: \`${summary.runId}\``);
  lines.push(`- **Project**: \`${summary.projectId}\``);
  lines.push(`- **Generated**: ${summary.generatedAt}`);
  if (summary.runDurationMs !== undefined) {
    lines.push(`- **Duration**: ${summary.runDurationMs} ms`);
  }
  if (summary.command) {
    const cmdString = `${summary.command.executable} ${summary.command.args.join(" ")}`;
    lines.push(`- **Command**: \`${cmdString}\``);
  }
  lines.push("");

  // Test summary
  lines.push("## Test Summary");
  lines.push("");
  if (summary.testSummary) {
    const t = summary.testSummary;
    lines.push("| Total | Passed | Failed | Skipped | Flaky |");
    lines.push("|---|---|---|---|---|");
    lines.push(`| ${t.total} | ${t.passed} | ${t.failed} | ${t.skipped} | ${t.flaky} |`);
    if (t.failedTests.length > 0) {
      lines.push("");
      lines.push("### Failed Tests");
      lines.push("");
      for (const failed of t.failedTests) {
        const title = failed.fullTitle ?? failed.title;
        const statusBadge = `[${failed.status}]`;
        lines.push(`- \`${statusBadge}\` ${title}`);
      }
    }
  } else {
    lines.push("_No test summary available._");
  }
  lines.push("");

  // Quality Gate
  lines.push("## Quality Gate");
  lines.push("");
  if (summary.qualityGate) {
    const qg = summary.qualityGate;
    lines.push(`- Status: \`${qg.status}\``);
    lines.push(`- Profile: \`${qg.profile}\``);
    lines.push(`- Exit Code: ${qg.exitCode ?? "null"}`);
    if (qg.warnings.length > 0) {
      lines.push("- QG Warnings:");
      for (const w of qg.warnings) {
        lines.push(`  - ${w}`);
      }
    }
  } else {
    lines.push("_Quality gate not evaluated for this run._");
  }
  lines.push("");

  // Run-level Warnings
  if (summary.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const w of summary.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  // Artifacts
  lines.push("## Artifacts");
  lines.push("");
  if (summary.reportLinks.allureReportDir) {
    lines.push(`- Allure HTML Report: \`${summary.reportLinks.allureReportDir}\``);
  }
  if (summary.reportLinks.qualityGateResultPath) {
    lines.push(`- Quality Gate Result: \`${summary.reportLinks.qualityGateResultPath}\``);
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Persists the QMO summary as JSON and Markdown to the given paths.
 * Pure I/O. Caller decides which paths via `runPathsFor`.
 */
export async function persistQmoSummary(
  jsonPath: string,
  markdownPath: string,
  summary: QmoSummary
): Promise<void> {
  await fs.mkdir(path.dirname(jsonPath), { recursive: true });
  await fs.writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8");
  await fs.mkdir(path.dirname(markdownPath), { recursive: true });
  await fs.writeFile(markdownPath, renderQmoSummaryMarkdown(summary), "utf8");
}

/**
 * Result of attempting to read the persisted Quality Gate result.
 *
 * The shape distinguishes "legitimately absent" (file does not exist —
 * project not Allure-configured or QG step skipped before write) from
 * "unreadable" (permission flip, IO error, malformed JSON, schema
 * mismatch). The QMO summary builder must NOT silently treat
 * "unreadable" as "absent": a previous run could have successfully
 * written a `failed` QG result, so producing `outcome: "ready"` based
 * on tests alone would mask a real release blocker.
 */
export type ReadQualityGateOutcome =
  | { kind: "found"; value: QualityGateResult }
  | { kind: "absent" }
  | { kind: "unreadable"; code: string };

/**
 * Reads the persisted Quality Gate result. T207 review fix:
 * distinguishes legitimate absence (ENOENT) from unreadable conditions
 * (EACCES / EIO / malformed JSON / schema mismatch) so the caller can
 * surface a warning instead of silently degrading to "ready".
 */
export async function readPersistedQualityGate(
  qualityGateResultPath: string
): Promise<ReadQualityGateOutcome> {
  let raw: string;
  try {
    raw = await fs.readFile(qualityGateResultPath, "utf8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
    if (code === "ENOENT") {
      return { kind: "absent" };
    }
    return { kind: "unreadable", code: code ?? "READ_FAILED" };
  }
  try {
    const { QualityGateResultSchema } = await import("@pwqa/shared");
    const parsed = QualityGateResultSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return { kind: "found", value: parsed.data };
    }
    return { kind: "unreadable", code: "SCHEMA_MISMATCH" };
  } catch {
    return { kind: "unreadable", code: "INVALID_JSON" };
  }
}

/** Re-export type for tests that need TestResultSummary in isolation. */
export type { TestResultSummary, QmoSummary, QmoSummaryOutcome, CommandTemplate };
