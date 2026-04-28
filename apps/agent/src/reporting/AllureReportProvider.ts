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
 * Out of scope for T202 (handled by dedicated tasks):
 *   - History trend (`history.json`) → T206
 *   - Quality Gate result → T205
 *   - CSV / log export consumption → T207
 *   - HTML report generation (CLI subprocess) → T204
 *   - Run pipeline integration → T203
 */
export const allureReportProvider: ReportProvider = {
  name: "allure",
  async readSummary(
    input: ReportProviderInput
  ): Promise<ReadSummaryResult | undefined> {
    const allureResultsDir = path.join(input.runDir, "allure-results");
    const { results, warnings } = await readAllureResults(allureResultsDir);

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
    const durationMs =
      typeof result.start === "number" && typeof result.stop === "number"
        ? Math.max(0, result.stop - result.start)
        : undefined;
    if (durationMs !== undefined) totalDurationMs += durationMs;

    switch (result.status) {
      case "passed":
        passed += 1;
        break;
      case "failed":
      case "broken":
        // Allure の `broken` はテスト本体ではなく fixture / setup の異常
        // を意味するが、Workbench TestResultSummary は単純な pass/fail/
        // skipped の三値しか持たない。PLAN.v2 §27 QMO View で broken を
        // 別 surface する判断は Phase 5 以降。本タスクでは failed に集約し、
        // warning に内訳を残して aggregator query で区別可能にする。
        failed += 1;
        if (result.status === "broken") {
          warnings.push(
            `Allure broken status (test infrastructure failure): ${result.name ?? result.uuid}`
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
        // として surface する)。集計から除外し warning に上げる。
        warnings.push(
          `Allure result has status "unknown" and will not be counted: ${result.name ?? result.uuid}`
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
    durationMs: totalDurationMs > 0 ? totalDurationMs : undefined,
    failedTests,
  };
}

function toFailedTest(
  result: AllureResult,
  projectRoot: string,
  durationMs: number | undefined
): FailedTest {
  // Allure の labels から file path を取り出す。allure-playwright は
  // `package` ラベルに `tests/example.spec.ts` 形式で spec の relative path
  // を入れることが多いが、未提供の場合もあるため optional 扱い。
  const packageLabel = result.labels.find((l) => l.name === "package");
  const filePath = packageLabel?.value
    ? path.isAbsolute(packageLabel.value)
      ? packageLabel.value
      : path.join(projectRoot, packageLabel.value)
    : undefined;

  return {
    testId: result.uuid,
    title: result.name ?? result.fullName ?? result.uuid,
    fullTitle: result.fullName ?? result.name ?? result.uuid,
    filePath,
    line: undefined,
    column: undefined,
    status: result.status,
    durationMs,
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
        label: a.name,
      })),
  };
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
