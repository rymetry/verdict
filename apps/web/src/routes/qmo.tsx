// Insights View route。ζ (Issue #13) で 2-col layout (main + side) の static mock を実装。
// Phase 1.2 で `useInsightsSummary()` hook (PLAN.v2 §16 AllureReportProvider + §19 API) に
// 切り替える際は、本ファイルの placeholder import を削除して hook 戻り値を props に渡す。
//
// 設計判断:
//  - `data-testid="qmo-view"` は γ で導入された router test の identifier を維持
//    (パス segment は当面 `/qmo` のまま。`/insights` への rename は Issue #10 やること欄で別途議論)。
//  - Section の `aria-label="Insights View"` を維持 (router test の
//    `getByText(/Insights View/)` 文字列 assertion 互換のため visible heading は持たないが、
//    aria-label で AT に view 名を伝える。文言を変える場合は router.test.tsx も同時更新)。
//  - Phase 1 placeholder fixture は `features/insights-view/placeholder-data.ts` から
//    明示的に import して props で InsightsView に渡す。Phase 1.2 でこの import を削除して
//    `useInsightsSummary()` 戻り値を渡せば silent fallback は構造上発生しない。
import * as React from "react";
import { createRoute } from "@tanstack/react-router";

import { InsightsView } from "@/features/insights-view/InsightsView";
import { SAMPLE_INSIGHTS } from "@/features/insights-view/placeholder-data";

import { rootRoute } from "./__root";

function InsightsViewRoute(): React.ReactElement {
  return (
    <section data-testid="qmo-view" aria-label="Insights View" className="flex flex-col gap-4">
      <InsightsView summary={SAMPLE_INSIGHTS} />
    </section>
  );
}

export const qmoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/qmo",
  component: InsightsViewRoute
});
