// §1.2 useInsightsSummary フル置換 (poc-remaining-work.md §1.2).
//
// Phase 1 の InsightsView は SAMPLE_INSIGHTS という静的 mock を表示
// していたため、operator から「本物のデータか mock か」が見分けられない
// silent UX failure 経路だった。本 hook は §1.1 (RunMetadata.summary)
// + §1.3 (Allure history JSONL) + 既存 useLatestQmoSummary (T208-2) を
// 合成して、現時点で **実データから埋められる項目だけ** を populate し、
// 未接続項目は空配列 (構造的に表示が無くなる) で返す。
//
// 設計判断:
//   - 全 Card Props は required (`InsightsSummary`) のまま。default
//     fallback を hook 内に置かないことで、未接続項目が UI で
//     `Phase 1.2 で接続予定` バッジ無しで何かを描いてしまう
//     silent failure を防ぐ (見えない=未接続)。
//   - QmoSummary が無い (= 未 run / Allure 未設定) 時は
//     `readiness.verdict = "not-ready"` ではなく `"conditional"` を返す。
//     "not-ready" は失敗 run が確定したケースに reserve する。
//   - useLatestQmoSummary は内部で fetchRuns + fetchQmoSummary を
//     既に組み合わせている。ここで再実装はしない。
import { useMemo } from "react";
import type {
  AllureHistoryEntry,
  AllureHistoryResponse,
  QmoSummary
} from "@pwqa/shared";

import { useAllureHistoryQuery } from "@/hooks/use-allure-history-query";
import { useCurrentProjectQuery } from "@/hooks/use-current-project-query";
import { useLatestQmoSummary } from "@/hooks/use-latest-qmo-summary";
import type {
  AllureSummaryRow,
  FailureItem,
  InsightsSummary,
  ReleaseReadiness,
  RunStat
} from "@/features/insights-view/types";

export interface InsightsSummaryQueryResult {
  /**
   * Derived summary. `null` when neither QMO summary nor Allure history
   * have data yet — caller renders a "no runs yet" placeholder.
   */
  readonly summary: InsightsSummary | null;
  readonly isLoading: boolean;
  readonly isError: boolean;
}

export function useInsightsSummary(): InsightsSummaryQueryResult {
  const project = useCurrentProjectQuery();
  const latest = useLatestQmoSummary();
  const history = useAllureHistoryQuery(project.data?.id ?? null);

  const summary = useMemo<InsightsSummary | null>(() => {
    const haveQmo = latest.summary !== null && latest.summary !== undefined;
    const haveHistory =
      history.data !== undefined && history.data.entries.length > 0;
    if (!haveQmo && !haveHistory) {
      return null;
    }
    return buildSummary(latest.summary ?? null, history.data ?? null);
  }, [latest.summary, history.data]);

  return {
    summary,
    // `useLatestQmoSummary` does not expose its own loading flag; the
    // closest signal is "no data + no error yet". We approximate by
    // checking whether either source is still pending — once both
    // resolve (even to empty), the caller can stop showing a spinner.
    isLoading:
      history.isPending ||
      (latest.summary === undefined && !latest.isError && !latest.isEmpty),
    isError: latest.isError || history.isError
  };
}

function buildSummary(
  qmo: QmoSummary | null,
  history: AllureHistoryResponse | null
): InsightsSummary {
  const readiness = buildReadiness(qmo, history);
  const stats = buildStats(qmo);
  const criticalFailures = buildCriticalFailures(qmo);
  const allureSummary = buildAllureSummary(history);
  return {
    readiness,
    stats,
    criticalFailures,
    knownIssues: [],
    topFlaky: [],
    ai: {
      adapterLabel: "—",
      body: "AI release readiness commentary is deferred to Phase 5.",
      verdictLine: ""
    },
    qualityGateStatus: qmo?.qualityGate?.status ?? "not-evaluated",
    qualityGate: [],
    allureSummary,
    recentRuns: []
  };
}

function buildReadiness(
  qmo: QmoSummary | null,
  history: AllureHistoryResponse | null
): ReleaseReadiness {
  const verdict = qmo?.outcome ?? deriveVerdictFromHistory(history) ?? "conditional";
  const score = computeScore(qmo, history);
  const versionLabel = qmo?.runId ?? historyLabel(history);
  return {
    score,
    verdict,
    versionLabel,
    description: describeReadiness(qmo, verdict)
  };
}

function deriveVerdictFromHistory(
  history: AllureHistoryResponse | null
): "ready" | "conditional" | "not-ready" | undefined {
  if (!history) return undefined;
  const last = history.entries[history.entries.length - 1];
  if (!last) return undefined;
  const failed = last.failed ?? 0;
  return failed === 0 ? "ready" : "not-ready";
}

function computeScore(
  qmo: QmoSummary | null,
  history: AllureHistoryResponse | null
): number {
  const t = qmo?.testSummary;
  if (t && t.total > 0) {
    return Math.round((t.passed / t.total) * 100);
  }
  const last = history?.entries[history.entries.length - 1];
  if (last && (last.total ?? 0) > 0) {
    return Math.round(((last.passed ?? 0) / (last.total ?? 1)) * 100);
  }
  return 0;
}

function historyLabel(history: AllureHistoryResponse | null): string {
  const last = history?.entries[history.entries.length - 1];
  if (!last) return "—";
  return last.runUuid ?? last.generatedAt ?? "—";
}

function describeReadiness(qmo: QmoSummary | null, verdict: string): string {
  if (!qmo) return "No run data yet. Trigger a run to populate readiness.";
  const t = qmo.testSummary;
  if (!t) return "Latest run completed without test summary.";
  if (verdict === "ready") {
    return `${t.passed}/${t.total} tests passing.`;
  }
  if (verdict === "not-ready") {
    return `${t.failed} test(s) failed in the latest run.`;
  }
  return `${t.passed}/${t.total} tests passing with warnings.`;
}

const STAT_LABELS = ["Total", "Passed", "Failed", "Flaky", "Skipped"] as const;

function buildStats(qmo: QmoSummary | null): RunStat[] {
  const t = qmo?.testSummary;
  if (!t) {
    return STAT_LABELS.map((label) => ({ label, value: "0" }));
  }
  return [
    { label: "Total", value: String(t.total) },
    { label: "Passed", value: String(t.passed) },
    { label: "Failed", value: String(t.failed) },
    { label: "Flaky", value: String(t.flaky) },
    { label: "Skipped", value: String(t.skipped) }
  ];
}

function buildCriticalFailures(qmo: QmoSummary | null): FailureItem[] {
  const failed = qmo?.testSummary?.failedTests ?? [];
  return failed.slice(0, 5).map((f, index) => ({
    id: f.testId ?? `fail-${index}`,
    scope: f.fullTitle?.split(">")[0]?.trim() ?? "test",
    title: f.title,
    meta: [
      f.filePath?.split("/").slice(-2).join("/"),
      f.line ? `:${f.line}` : null,
      f.status,
      f.durationMs ? `${Math.round(f.durationMs / 1000)}s` : null
    ]
      .filter(Boolean)
      .join(" · ")
  }));
}

function buildAllureSummary(
  history: AllureHistoryResponse | null
): AllureSummaryRow[] {
  const entries = history?.entries ?? [];
  if (entries.length === 0) return [];
  const last = entries[entries.length - 1] as AllureHistoryEntry;
  const prev = entries[entries.length - 2] as AllureHistoryEntry | undefined;
  return [
    {
      name: "Pass rate",
      previous: prev ? formatPassRate(prev) : "—",
      actual: formatPassRate(last),
      status: (last.failed ?? 0) === 0 ? "pass" : "fail"
    },
    {
      name: "Total tests",
      previous: prev ? String(prev.total ?? 0) : "—",
      actual: String(last.total ?? 0),
      status: "pass"
    },
    {
      name: "Failures",
      previous: prev ? String(prev.failed ?? 0) : "—",
      actual: String(last.failed ?? 0),
      status: (last.failed ?? 0) === 0 ? "pass" : "fail"
    }
  ];
}

function formatPassRate(entry: AllureHistoryEntry): string {
  const total = entry.total ?? 0;
  if (total === 0) return "0%";
  const rate = ((entry.passed ?? 0) / total) * 100;
  return `${rate.toFixed(1)}%`;
}
