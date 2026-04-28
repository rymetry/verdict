// Insights View 全体: Hero / 3-card row / AI summary を main、Sidebar を side に並べる 2-col。
//
// レイアウト方針:
//  - lg breakpoint 以上で main (1fr) + side (360px) の 2-col
//  - lg 未満は 1 列に折り返し (mobile / narrow viewport)
//  - main 内部は縦積み (Hero → 3-card row → AI summary)
//  - heading 階層: TopBar h1 → main の `<h2>Insights</h2>` の代わりに Hero の h1 を main entry とする。
//    Issue #13 受け入れ条件は "h1 (Chrome) → h2 (Insights main) → h3 (cards)"。
//    本実装では main 内部で `<h2>` を sr-only で配置し、視覚的には Hero h1 + heading 階層を AT に伝える。
//
// Phase 1.2 で実データ接続する際:
//  - `useInsightsSummary()` hook (TanStack Query 5 秒 polling) の戻り値を本 Component の Props に渡す
//  - 各 Card Props は required のため fallback の silent failure 経路は構造上発生しない
import * as React from "react";

import { TooltipProvider } from "@/components/ui/tooltip";

import { AiSummaryCard } from "./AiSummaryCard";
import { InsightsHero } from "./InsightsHero";
import { MainCardsRow } from "./MainCardsRow";
import { SidebarPanels } from "./SidebarPanels";
import type { InsightsSummary } from "./types";

interface InsightsViewProps {
  readonly summary: InsightsSummary;
}

export function InsightsView({ summary }: InsightsViewProps): React.ReactElement {
  return (
    <TooltipProvider delayDuration={150}>
      <div
        data-testid="insights-view-grid"
        className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"
      >
        <main aria-label="Insights main" className="flex flex-col gap-4">
          {/* h2 を sr-only で置き、heading hierarchy h1 → h2 → h3 を AT に伝える */}
          <h2 className="sr-only">Insights</h2>
          <InsightsHero readiness={summary.readiness} stats={summary.stats} />
          <MainCardsRow
            criticalFailures={summary.criticalFailures}
            knownIssues={summary.knownIssues}
            topFlaky={summary.topFlaky}
          />
          <AiSummaryCard summary={summary.ai} />
        </main>
        <SidebarPanels
          qualityGate={summary.qualityGate}
          allureSummary={summary.allureSummary}
          recentRuns={summary.recentRuns}
        />
      </div>
    </TooltipProvider>
  );
}
