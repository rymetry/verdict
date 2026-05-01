import * as path from "node:path";
import { type FailedTest, type TestResultSummary } from "@pwqa/shared";
import { readAllureResults, type AllureResult } from "./allureResultsReader.js";
import type {
  ReadSummaryResult,
  ReportProvider,
  ReportProviderInput,
} from "./ReportProvider.js";

/**
 * AllureReportProvider (Phase 1.2 / T202).
 *
 * Reads `<runDir>/allure-results/*-result.json` (Workbench convention per
 * PLAN.v2 §22 detect/archive/copy pattern, fed by run pipeline in T203) and
 * normalizes Allure-specific concepts into the Workbench-shared
 * `TestResultSummary` shape. Provider-specific concerns (status mapping,
 * label parsing, attachment shape) stay confined to this module — callers
 * see only the normalized contract.
 *
 * **Status mapping note (PLAN.v2 §27)**: The shared `TestResultSummary`
 * shape exposes only `passed` / `failed` / `skipped` counters. Allure's
 * `broken` (test infrastructure failure) is folded into `failed` because
 * the shared schema does not currently differentiate. The distinction is
 * not lost: each broken test is preserved in `failedTests[]` with its
 * original `status: "broken"` string, so QMO View (Phase 5) can
 * `failedTests.filter(t => t.status === "broken")` to surface
 * infrastructure failures separately. A more structured solution
 * (extending `TestResultSummary` with `brokenCount` / `unknownCount`)
 * is deferred to Phase 5 when QMO View needs are concrete; the warning
 * codes added here (`ALLURE_BROKEN_TEST`, `ALLURE_UNKNOWN_STATUS`,
 * `ALLURE_MALFORMED_TIMING`) provide the bridge until then.
 *
 * Out of scope for T202 (handled by dedicated tasks):
 *   - History trend (`history.json`) → T206
 *   - Quality Gate result → T205
 *   - CSV / log export consumption → T207
 *   - HTML report generation (CLI subprocess) → T204
 *   - Run pipeline integration → T203
 */

/**
 * Stable warning code prefixes for Allure-specific summary signals.
 * Embedded in warning text so log aggregators / QMO View can pattern-match
 * specific conditions without parsing free text. Adding a new code requires
 * updating callers that branch on warnings.
 */
export const ALLURE_WARNING_CODES = {
  /** Allure status="broken" — test infrastructure failure folded into `failed` count */
  BROKEN: "ALLURE_BROKEN_TEST",
  /** Allure status="unknown" — neither pass nor fail; excluded from counters */
  UNKNOWN: "ALLURE_UNKNOWN_STATUS",
  /** Result file lacks valid `start`/`stop` or has `stop < start` — duration unreliable */
  MALFORMED_TIMING: "ALLURE_MALFORMED_TIMING",
} as const;
export const allureReportProvider: ReportProvider = {
  name: "allure",
  async readSummary(
    input: ReportProviderInput
  ): Promise<ReadSummaryResult | undefined> {
    const allureResultsDir = path.join(input.runDir, "allure-results");
    let read: Awaited<ReturnType<typeof readAllureResults>>;
    try {
      read = await readAllureResults(allureResultsDir);
    } catch (error) {
      // Missing `<runDir>/allure-results/` directory means the project did
      // not use Allure for this run. §1.1 wires this provider into the
      // default composite, so silent skip is the correct path for plain
      // Playwright projects; other error codes (EACCES, EIO, EMFILE...)
      // propagate so the operator sees the real cause.
      const code = errorCodeOf(error);
      if (code === "ENOENT") {
        return undefined;
      }
      throw error;
    }

    const { results, warnings } = read;

    // 全 result file が parse 失敗した場合でも warnings は返す。完全な空
    // ディレクトリ (`results === [] && warnings === []`) は「Allure データなし」
    // として undefined を返し、caller (Phase 1.2 で T203 が wire up) に
    // 「provider をスキップ」のシグナルを与える。
    if (results.length === 0 && warnings.length === 0) {
      return undefined;
    }

    const summary = aggregateAllureResults(results, input.projectRoot, warnings);
    return { summary, warnings };
  },
};

function errorCodeOf(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "UNKNOWN";
}

function aggregateAllureResults(
  results: ReadonlyArray<AllureResult>,
  projectRoot: string,
  warnings: string[]
): TestResultSummary {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let totalDurationMs = 0;
  const failedTests: FailedTest[] = [];

  for (const result of results) {
    const durationMs = computeDuration(result, warnings);
    if (durationMs !== undefined) totalDurationMs += durationMs;

    switch (result.status) {
      case "passed":
        passed += 1;
        break;
      case "failed":
      case "broken":
        // Allure の `broken` はテスト本体ではなく fixture / setup の異常を
        // 意味する。Workbench TestResultSummary が pass/fail/skipped の三値
        // しか持たないため failed に集約するが、`failedTests[].status` には
        // raw な "broken" 文字列が残るので QMO View (Phase 5) で
        // `filter(t => t.status === "broken")` により再度区別可能。
        // PLAN.v2 §27 で broken を別 surface する判断は Phase 5 以降。
        failed += 1;
        if (result.status === "broken") {
          warnings.push(
            `${ALLURE_WARNING_CODES.BROKEN}: test infrastructure failure: ${
              result.name ?? result.uuid
            }`
          );
        }
        failedTests.push(toFailedTest(result, projectRoot, durationMs));
        break;
      case "skipped":
        skipped += 1;
        break;
      case "unknown":
        // unknown はテスト実行が中断 / report 生成漏れ等を示唆する。pass にも
        // fail にも入れない (count 整合性が崩れるが PLAN.v2 §27 で異常検知
        // として surface する)。集計から除外し structured warning code 付き
        // で警告。aggregator query で `ALLURE_UNKNOWN_STATUS` を pattern
        // match できる。
        warnings.push(
          `${ALLURE_WARNING_CODES.UNKNOWN}: result has status "unknown" and will not be counted: ${
            result.name ?? result.uuid
          }`
        );
        break;
    }
  }

  return {
    total: passed + failed + skipped,
    passed,
    failed,
    skipped,
    flaky: 0, // Allure 単一 run の result file には flaky 判定なし。T206 で history を読んで補う
    // `TestResultSummarySchema.durationMs` is `z.number().int()`. Allure
    // CLI can emit fractional millisecond timestamps in some
    // environments (Date.now() backed by microsecond clocks, or
    // accumulated FP rounding when summing), so we defensively round
    // before emitting. Without this, downstream QMO summary persistence
    // fails schema validation (observed in CI: "qmo-summary failed
    // schema validation; issues=testSummary.durationMs").
    durationMs: totalDurationMs > 0 ? Math.round(totalDurationMs) : undefined,
    failedTests,
  };
}

/**
 * Computes duration in ms from Allure `start`/`stop` timestamps. Emits a
 * structured warning when timing is malformed (missing fields for non-
 * skipped tests, or `stop < start` which would otherwise be silently
 * coerced to 0). Skipped tests legitimately have no timing, so they do
 * not trigger the warning.
 */
function computeDuration(result: AllureResult, warnings: string[]): number | undefined {
  const hasStart = typeof result.start === "number";
  const hasStop = typeof result.stop === "number";

  if (hasStart && hasStop) {
    const raw = (result.stop as number) - (result.start as number);
    if (raw < 0) {
      warnings.push(
        `${ALLURE_WARNING_CODES.MALFORMED_TIMING}: stop < start in result ${
          result.name ?? result.uuid
        }; coercing to 0`
      );
      return 0;
    }
    return raw;
  }

  // Missing timing on a non-skipped test is a data-quality signal: a real
  // test run that produced a result file should have both timestamps.
  // Skipped tests legitimately omit them.
  if (result.status !== "skipped") {
    warnings.push(
      `${ALLURE_WARNING_CODES.MALFORMED_TIMING}: missing start/stop in result ${
        result.name ?? result.uuid
      }`
    );
  }
  return undefined;
}

function toFailedTest(
  result: AllureResult,
  projectRoot: string,
  durationMs: number | undefined
): FailedTest {
  // Stack trace carries the most reliable project-relative spec path in
  // allure-playwright output. The `package` label may be just a basename
  // (`example.spec.ts`), so only use it when it includes a directory segment.
  const packageLabel = result.labels.find((l) => l.name === "package");
  const filePath =
    filePathFromStack(result.statusDetails?.trace, projectRoot) ??
    filePathFromPackageLabel(packageLabel?.value, projectRoot);
  const relativeFilePath = filePath
    ? normalizeRelativePath(path.relative(projectRoot, filePath))
    : undefined;

  return {
    testId: result.uuid,
    title: result.name ?? result.fullName ?? result.uuid,
    fullTitle: result.fullName ?? result.name ?? result.uuid,
    filePath,
    relativeFilePath,
    absoluteFilePath: filePath,
    line: undefined,
    column: undefined,
    status: result.status,
    // FailedTestSchema.durationMs is z.number().int() — same defensive
    // rounding rationale as the aggregate summary above.
    durationMs: durationMs !== undefined ? Math.round(durationMs) : undefined,
    message: result.statusDetails?.message,
    stack: result.statusDetails?.trace,
    // Allure attachments の `source` は relative filename (allure-results 内)。
    // 絶対 path 化は T203 (run pipeline 統合) で `<runDir>/allure-results/`
    // を context として持ったうえで artifact 解決する。本タスクでは raw
    // source 文字列のみを保持し、Phase 5 (Failure Review / Artifact Viewer)
    // で完全な path に展開する設計分担。
    attachments: result.attachments
      .filter((a) => Boolean(a.source))
      .map((a) => ({
        kind: classifyAttachmentKind(a.name, a.type),
        path: a.source,
        relativePath: normalizeRelativePath(a.source),
        label: a.name,
      })),
  };
}

function filePathFromPackageLabel(
  label: string | undefined,
  projectRoot: string
): string | undefined {
  if (!label) return undefined;
  if (path.isAbsolute(label)) return label;
  if (!label.includes("/") && !label.includes("\\")) return undefined;
  return path.join(projectRoot, label);
}

function filePathFromStack(
  trace: string | undefined,
  projectRoot: string
): string | undefined {
  if (!trace) return undefined;
  const normalizedRoot = projectRoot.split(path.sep).map(escapeRegex).join("[/\\\\]");
  const absoluteMatches = Array.from(
    trace.matchAll(new RegExp(`(${normalizedRoot}[/\\\\][^\\s:)]+)`, "g"))
  )
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value))
    .filter((value) => !/[\\/]node_modules[\\/]/.test(value));
  const deepest = absoluteMatches.at(-1);
  if (deepest) {
    return deepest.replace(/\\/g, path.sep);
  }
  const relativeMatch = trace.match(/(?:^|\s)([A-Za-z0-9_.@/-]*tests[/\\][^\s:)]+\.spec\.[cm]?[tj]sx?)/m);
  if (relativeMatch?.[1]) {
    return path.join(projectRoot, relativeMatch[1]);
  }
  return undefined;
}

function normalizeRelativePath(value: string): string {
  return value.split(/[\\/]+/).join("/");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classifyAttachmentKind(
  name: string,
  contentType: string | undefined
): "log" | "trace" | "screenshot" | "video" | "json" | "html" {
  const lower = name.toLowerCase();
  if (lower.includes("trace")) return "trace";
  if (lower.includes("video")) return "video";
  if (lower.includes("screenshot")) return "screenshot";
  if (contentType?.startsWith("application/json")) return "json";
  if (contentType?.startsWith("text/html")) return "html";
  return "log";
}
