import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  RepairComparisonSchema,
  type FailedTest,
  type RepairComparison,
  type RepairComparisonArtifactLinks,
  type RepairComparisonDelta,
  type RepairComparisonVerdict,
  type RepairFailureComparison,
  type RunMetadata,
  type TestResultSummary
} from "@pwqa/shared";

const RUN_ID_SEGMENT_RE = /^run-[a-z0-9]+-[a-f0-9]{8}$/;

export class RepairComparisonPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepairComparisonPathError";
  }
}

export function isValidRunIdSegment(value: string): boolean {
  return RUN_ID_SEGMENT_RE.test(value);
}

export function repairComparisonPathFor(
  baseline: RunMetadata,
  rerunId: string
): string {
  if (!isValidRunIdSegment(rerunId)) {
    throw new RepairComparisonPathError("rerunId is not a valid run id segment.");
  }
  return path.join(baseline.paths.runDir, "reruns", rerunId, "comparison.json");
}

export function buildRepairComparison({
  baseline,
  rerun,
  generatedAt = new Date().toISOString()
}: {
  baseline: RunMetadata;
  rerun: RunMetadata;
  generatedAt?: string;
}): RepairComparison {
  const beforeSummary = baseline.summary;
  const afterSummary = rerun.summary;
  const warnings = comparisonWarnings(baseline, rerun);
  const resolvedFailures: RepairFailureComparison[] = [];
  const remainingFailures: RepairFailureComparison[] = [];
  const newFailures: RepairFailureComparison[] = [];

  if (beforeSummary && afterSummary) {
    const beforeFailures = failureMap(beforeSummary.failedTests);
    const afterFailures = failureMap(afterSummary.failedTests);
    for (const [key, before] of beforeFailures) {
      const after = afterFailures.get(key);
      if (after) {
        remainingFailures.push({ key, title: before.title, before, after });
      } else {
        resolvedFailures.push({ key, title: before.title, before });
      }
    }
    for (const [key, after] of afterFailures) {
      if (!beforeFailures.has(key)) {
        newFailures.push({ key, title: after.title, after });
      }
    }
  }

  return RepairComparisonSchema.parse({
    baselineRunId: baseline.runId,
    rerunId: rerun.runId,
    generatedAt,
    verdict: verdictFor({
      before: baseline,
      after: rerun,
      resolvedFailures,
      newFailures
    }),
    before: {
      status: baseline.status,
      summary: beforeSummary
    },
    after: {
      status: rerun.status,
      summary: afterSummary
    },
    delta:
      beforeSummary && afterSummary
        ? summaryDelta(beforeSummary, afterSummary)
        : undefined,
    resolvedFailures,
    remainingFailures,
    newFailures,
    artifacts: {
      before: artifactLinksFor(baseline),
      after: artifactLinksFor(rerun)
    },
    warnings
  });
}

export async function persistRepairComparison({
  baseline,
  rerun,
  generatedAt
}: {
  baseline: RunMetadata;
  rerun: RunMetadata;
  generatedAt?: string;
}): Promise<RepairComparison> {
  const comparison = buildRepairComparison({ baseline, rerun, generatedAt });
  const target = repairComparisonPathFor(baseline, rerun.runId);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(comparison, null, 2)}\n`, "utf8");
  return comparison;
}

export async function readRepairComparison(
  baseline: RunMetadata,
  rerunId: string
): Promise<RepairComparison> {
  const target = repairComparisonPathFor(baseline, rerunId);
  const raw = await fs.readFile(target, "utf8");
  return RepairComparisonSchema.parse(JSON.parse(raw));
}

function summaryDelta(
  before: TestResultSummary,
  after: TestResultSummary
): RepairComparisonDelta {
  return {
    total: after.total - before.total,
    passed: after.passed - before.passed,
    failed: after.failed - before.failed,
    skipped: after.skipped - before.skipped,
    flaky: after.flaky - before.flaky
  };
}

function artifactLinksFor(run: RunMetadata): RepairComparisonArtifactLinks {
  return {
    runDir: run.paths.runDir,
    playwrightHtml: run.paths.playwrightHtml,
    allureReportDir: run.paths.allureReportDir,
    qmoSummaryJsonPath: run.paths.qmoSummaryJsonPath
  };
}

function failureMap(failures: FailedTest[]): Map<string, FailedTest> {
  const mapped = new Map<string, FailedTest>();
  for (const failure of failures) {
    mapped.set(failureKey(failure), failure);
  }
  return mapped;
}

function failureKey(failure: FailedTest): string {
  if (failure.testId) return `id:${failure.testId}`;
  if (failure.filePath && failure.line) {
    return `loc:${failure.filePath}:${failure.line}:${failure.column ?? 0}:${failure.title}`;
  }
  return `title:${failure.fullTitle ?? failure.title}`;
}

function comparisonWarnings(before: RunMetadata, after: RunMetadata): string[] {
  const warnings: string[] = [];
  if (!before.summary) {
    warnings.push("Baseline run summary is unavailable; repair verdict is inconclusive.");
  }
  if (!after.summary) {
    warnings.push("Rerun summary is unavailable; repair verdict is inconclusive.");
  }
  if (before.status === "queued" || before.status === "running") {
    warnings.push("Baseline run is not completed.");
  }
  if (after.status === "queued" || after.status === "running") {
    warnings.push("Rerun is not completed.");
  }
  if (after.status === "error" || after.status === "cancelled") {
    warnings.push(`Rerun ended with ${after.status} status.`);
  }
  return warnings;
}

function verdictFor({
  before,
  after,
  resolvedFailures,
  newFailures
}: {
  before: RunMetadata;
  after: RunMetadata;
  resolvedFailures: RepairFailureComparison[];
  newFailures: RepairFailureComparison[];
}): RepairComparisonVerdict {
  if (!before.summary || !after.summary) return "inconclusive";
  if (after.status === "error" || after.status === "cancelled") return "inconclusive";
  if (newFailures.length > 0 || after.summary.failed > before.summary.failed) return "regressed";
  if (before.summary.failed > 0 && after.summary.failed === 0) return "fixed";
  if (resolvedFailures.length > 0 && after.summary.failed < before.summary.failed) return "improved";
  if (after.summary.failed === before.summary.failed) return "unchanged";
  return "inconclusive";
}
