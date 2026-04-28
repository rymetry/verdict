// Insights View 全体: Hero / 3-card row / AI summary を main、Sidebar を side に並べる 2-col。
//
// レイアウト方針:
//  - lg breakpoint 以上で main (1fr) + side (360px) の 2-col
//  - lg 未満は 1 列に折り返し (mobile / narrow viewport)
//  - main 内部は縦積み (Hero → 3-card row → AI summary)
//
// heading 階層 (Issue #13 受け入れ条件 \"h1 (Chrome) → h2 (Insights main) → h3 (cards)\"):
//  - h1: TopBar の Brand "Playwright Workbench" (app-shell に常駐)
//  - h2: InsightsHero "Release Readiness" (本 view の main entry)
//  - h3: 各 card (重大な失敗 / 既知の問題 / Top Flaky / AI / Quality Gate / Allure / Recent runs) = 7 件
//
// shadcn primitives 採用方針 (Issue #13 受け入れ条件):
//  - Card / Badge / Button / Tooltip を使用。
//  - Tabs は本 view の static layout (Hero + 3-card grid + AI + sidebar) に視覚的に必要な分岐がなく、
//    挿入すると UX が損なわれるため意図的に省略。Phase 1.2 で「Allure サマリ / 履歴 / Trend」を切り替える
//    ようなフィルタ UI が必要になったタイミングで Tabs primitive を導入する想定。
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
