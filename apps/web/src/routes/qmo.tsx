// Insights View route。ζ (Issue #13) で 2-col layout (main + side) の static mock を実装。
// Phase 1.2 で `useInsightsSummary()` hook (PLAN.v2 §16 AllureReportProvider + §19 API) に
// 切り替える際は、本ファイルの placeholder import を削除して hook 戻り値を props に渡す。
//
// 設計判断:
//  - `data-testid="qmo-view"` は γ で導入された router test の identifier を維持
//    (パス segment は当面 `/qmo` のまま。`/insights` への rename は Issue #10 やること欄で別途議論)。
//  - Section の `aria-label="Insights View"` で AT に view 名を伝える。router test では
//    `toHaveAttribute("aria-label", "Insights View")` でこの contract を pin している
//    (apps/web/test/routes/router.test.tsx の `/qmo` ケース)。文言を変える場合は同 test も同時更新。
//  - Phase 1 placeholder fixture は `features/insights-view/placeholder-data.ts` から
//    明示的に import して props で InsightsView に渡す。Phase 1.2 でこの import を削除して
//    `useInsightsSummary()` 戻り値を渡せば silent fallback は構造上発生しない。
//
// Phase 1.2 / T208-2 増分:
//  - `<QmoSummaryBanner />` を InsightsView の上に配置し、最新 run の **real**
//    QMO Release Readiness Summary (T207 で persist された値) を表示する。
//  - InsightsView 自体は引き続き SAMPLE_INSIGHTS で描画 (Phase 1.2 後段の
//    `useInsightsSummary` フル置換まで存続)。banner は real data の最初の
//    visible 表示で、Phase 1.2 lifecycle (T200-T207) が actual に動いているか
//    を operator が目視確認できる。
import * as React from "react";
import { createRoute } from "@tanstack/react-router";

import { AllureHistoryTrendCard } from "@/features/allure-history-trend-card/AllureHistoryTrendCard";
import { InsightsView } from "@/features/insights-view/InsightsView";
import { QmoSummaryBanner } from "@/features/qmo-summary-banner/QmoSummaryBanner";
import { useCurrentProjectQuery } from "@/hooks/use-current-project-query";
import { useInsightsSummary } from "@/hooks/use-insights-summary";
import { useLatestQmoSummary } from "@/hooks/use-latest-qmo-summary";

import { rootRoute } from "./__root";

function InsightsViewRoute(): React.ReactElement {
  const latest = useLatestQmoSummary();
  // §1.3: Allure history is project-scoped (one trend file per project),
  // so the trend card needs the current project's id to fetch.
  const project = useCurrentProjectQuery();
  // §1.2: derived InsightsSummary from real QMO + Allure history. When
  // both data sources are empty, `summary === null` and we render an
  // explicit empty state instead of mock content (the previous Phase 1
  // path silently rendered SAMPLE_INSIGHTS even with zero real data).
  const insights = useInsightsSummary();
  return (
    <section data-testid="qmo-view" aria-label="Insights View" className="flex flex-col gap-4">
      <QmoSummaryBanner
        summary={latest.summary}
        isError={latest.isError}
        isEmpty={latest.isEmpty}
      />
      <AllureHistoryTrendCard projectId={project.data?.id ?? null} />
      {insights.summary !== null ? (
        <InsightsView summary={insights.summary} />
      ) : (
        <p
          data-testid="insights-view-empty"
          className="text-sm text-[var(--ink-3)]"
        >
          No run data yet. Trigger a run to populate the insights view.
        </p>
      )}
    </section>
  );
}

export const qmoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/qmo",
  component: InsightsViewRoute
});
