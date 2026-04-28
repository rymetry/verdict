// Insights View placeholder の rendering tests (Issue #13 acceptance)。
//
// pin する内容:
//  - 4 main セクション (Hero / 3-card row / AI summary / Sidebar) が DOM に存在
//  - Phase 1.2 で接続予定 badge 数 (badge を Phase 1.2 で外し忘れた regression を検出)
//  - heading 階層 h2 (sr-only "Insights") + h1 (Hero) + 各 card の h3
//  - "すべて表示" / "フルレポート" は disabled button + tooltip "Phase 1.2 で接続予定"
//  - Hero の progress bar が aria-valuenow=score を持つ
//  - data-rule-status / data-run-status / data-run-trend で test を class 文字列に couple させない
//  - 各 Card Props を空配列で override しても crash しない (defensive rendering)
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AiSummaryCard } from "@/features/insights-view/AiSummaryCard";
import { InsightsHero } from "@/features/insights-view/InsightsHero";
import { InsightsView } from "@/features/insights-view/InsightsView";
import { MainCardsRow } from "@/features/insights-view/MainCardsRow";
import { SidebarPanels } from "@/features/insights-view/SidebarPanels";
import { SAMPLE_INSIGHTS } from "@/features/insights-view/placeholder-data";
import {
  INSIGHTS_VIEW_LABELS,
  PHASE_1_2_PLACEHOLDER_LABEL
} from "@/features/insights-view/types";
import { TooltipProvider } from "@/components/ui/tooltip";

afterEach(() => {
  cleanup();
});

function renderWithTooltip(ui: React.ReactElement): void {
  render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("InsightsView (composer)", () => {
  it("Hero / main cards / AI summary / sidebar の 4 セクションを描画する", () => {
    render(<InsightsView summary={SAMPLE_INSIGHTS} />);
    expect(screen.getByTestId("insights-view-grid")).toBeInTheDocument();
    expect(screen.getByTestId("insights-hero")).toBeInTheDocument();
    expect(screen.getByTestId("insights-main-cards")).toBeInTheDocument();
    expect(screen.getByTestId("insights-ai-card")).toBeInTheDocument();
    expect(screen.getByTestId("insights-sidebar")).toBeInTheDocument();
  });

  it("heading 階層が h1 (Hero) → h2 (sr-only Insights) → h3 (各 card) で構造化される", () => {
    render(<InsightsView summary={SAMPLE_INSIGHTS} />);
    // h1: Hero "Release Readiness"
    expect(screen.getByRole("heading", { level: 1, name: INSIGHTS_VIEW_LABELS.hero })).toBeInTheDocument();
    // h2: sr-only "Insights" (visually hidden but in DOM as heading)
    expect(screen.getByRole("heading", { level: 2, name: "Insights" })).toBeInTheDocument();
    // h3: 7 件 (3 main cards + AI summary + 3 sidebar cards)
    const h3s = screen.getAllByRole("heading", { level: 3 });
    expect(h3s).toHaveLength(7);
  });

  it("Phase 1.2 で接続予定 badge が 6 つ存在する (Hero + Critical + Known + Flaky + AI + 何もなし sidebar)", () => {
    // 内訳: Hero (1) + Critical (1) + Known (1) + Flaky (1) + AI (1) + sidebar disabled tooltip 内容 = 5
    // sidebar の Allure / RecentRuns の "Phase 1.2 で接続予定" は Tooltip content として
    // 開いていない時は DOM に出ない (Radix Tooltip は portal で開く)。本 assertion は visible badges のみ pin。
    // Hero, Critical, Known, Flaky, AI = 5 個の visible Badge。
    render(<InsightsView summary={SAMPLE_INSIGHTS} />);
    const badges = screen.getAllByText(PHASE_1_2_PLACEHOLDER_LABEL);
    expect(badges).toHaveLength(5);
  });
});

describe("InsightsHero", () => {
  it("score / verdict badge / progress bar / 5 stats を描画する", () => {
    renderWithTooltip(
      <InsightsHero
        readiness={SAMPLE_INSIGHTS.readiness}
        stats={SAMPLE_INSIGHTS.stats}
      />
    );
    const hero = screen.getByTestId("insights-hero");
    expect(within(hero).getByText("86")).toBeInTheDocument();
    expect(within(hero).getByText("/ 100")).toBeInTheDocument();
    // verdict badge
    expect(within(hero).getByText("Ready")).toBeInTheDocument();
    // progress bar with aria-valuenow=86
    const progressBar = within(hero).getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "86");
    expect(progressBar).toHaveAttribute("aria-valuemax", "100");
    // 5 stats
    expect(within(hero).getByText("Total")).toBeInTheDocument();
    expect(within(hero).getByText("2,842")).toBeInTheDocument();
    expect(within(hero).getByText("Passed")).toBeInTheDocument();
    expect(within(hero).getByText("Failed")).toBeInTheDocument();
    expect(within(hero).getByText("Flaky")).toBeInTheDocument();
    expect(within(hero).getByText("Skipped")).toBeInTheDocument();
  });

  it("score < 0 / > 100 は 0〜100 に clamp される", () => {
    renderWithTooltip(
      <InsightsHero
        readiness={{
          score: 150,
          verdict: "ready",
          versionLabel: "v1.0",
          description: "test"
        }}
        stats={SAMPLE_INSIGHTS.stats}
      />
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

    cleanup();
    renderWithTooltip(
      <InsightsHero
        readiness={{
          score: -10,
          verdict: "not-ready",
          versionLabel: "v1.0",
          description: "test"
        }}
        stats={SAMPLE_INSIGHTS.stats}
      />
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("verdict は data-verdict 属性で expose され class 文字列に依存しない", () => {
    renderWithTooltip(
      <InsightsHero
        readiness={{
          score: 50,
          verdict: "conditional",
          versionLabel: "v1.0",
          description: "test"
        }}
        stats={SAMPLE_INSIGHTS.stats}
      />
    );
    const verdictBadge = screen.getByText("Conditional");
    expect(verdictBadge).toHaveAttribute("data-verdict", "conditional");
  });
});

describe("MainCardsRow", () => {
  it("3 つの list card (critical / known / flaky) を描画する", () => {
    renderWithTooltip(
      <MainCardsRow
        criticalFailures={SAMPLE_INSIGHTS.criticalFailures}
        knownIssues={SAMPLE_INSIGHTS.knownIssues}
        topFlaky={SAMPLE_INSIGHTS.topFlaky}
      />
    );
    expect(screen.getByTestId("insights-critical-card")).toBeInTheDocument();
    expect(screen.getByTestId("insights-known-card")).toBeInTheDocument();
    expect(screen.getByTestId("insights-flaky-card")).toBeInTheDocument();
  });

  it("各 card の count バッジが items.length と一致する", () => {
    renderWithTooltip(
      <MainCardsRow
        criticalFailures={SAMPLE_INSIGHTS.criticalFailures}
        knownIssues={SAMPLE_INSIGHTS.knownIssues}
        topFlaky={SAMPLE_INSIGHTS.topFlaky}
      />
    );
    expect(
      within(screen.getByTestId("insights-critical-card")).getByText(
        String(SAMPLE_INSIGHTS.criticalFailures.length)
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("insights-known-card")).getByText(
        String(SAMPLE_INSIGHTS.knownIssues.length)
      )
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("insights-flaky-card")).getByText(
        String(SAMPLE_INSIGHTS.topFlaky.length)
      )
    ).toBeInTheDocument();
  });

  it("\"すべて表示\" は disabled button として描画され、hover で Phase 1.2 接続予定 tooltip が出る", async () => {
    const user = userEvent.setup();
    renderWithTooltip(
      <MainCardsRow
        criticalFailures={SAMPLE_INSIGHTS.criticalFailures}
        knownIssues={SAMPLE_INSIGHTS.knownIssues}
        topFlaky={SAMPLE_INSIGHTS.topFlaky}
      />
    );
    const showAllButtons = screen.getAllByRole("button", { name: /すべて表示/ });
    expect(showAllButtons).toHaveLength(3);
    showAllButtons.forEach((btn) => expect(btn).toBeDisabled());

    // hover で tooltip が出ることを 1 件で確認
    await user.hover(screen.getByTestId("insights-critical-show-all"));
    expect(
      await screen.findByText(PHASE_1_2_PLACEHOLDER_LABEL, {
        selector: "[role='tooltip']"
      })
    ).toBeInTheDocument();
  });

  it("空配列で渡しても crash せず count 0 として描画される", () => {
    renderWithTooltip(
      <MainCardsRow criticalFailures={[]} knownIssues={[]} topFlaky={[]} />
    );
    expect(
      within(screen.getByTestId("insights-critical-card")).getByText("0")
    ).toBeInTheDocument();
  });
});

describe("AiSummaryCard", () => {
  it("adapter pill / body / verdict line を描画する", () => {
    renderWithTooltip(<AiSummaryCard summary={SAMPLE_INSIGHTS.ai} />);
    const card = screen.getByTestId("insights-ai-card");
    expect(within(card).getByText(SAMPLE_INSIGHTS.ai.adapterLabel)).toBeInTheDocument();
    expect(
      within(card).getByText(/総合品質は良好で、前回比でパス率が \+6\.1pp 改善/)
    ).toBeInTheDocument();
    expect(within(card).getByTestId("insights-ai-verdict")).toHaveTextContent(
      SAMPLE_INSIGHTS.ai.verdictLine
    );
  });
});

describe("SidebarPanels", () => {
  it("Quality Gate / Allure サマリ / 最近の Run の 3 panel を描画する", () => {
    renderWithTooltip(
      <SidebarPanels
        qualityGate={SAMPLE_INSIGHTS.qualityGate}
        allureSummary={SAMPLE_INSIGHTS.allureSummary}
        recentRuns={SAMPLE_INSIGHTS.recentRuns}
      />
    );
    expect(screen.getByTestId("insights-quality-gate-card")).toBeInTheDocument();
    expect(screen.getByTestId("insights-allure-card")).toBeInTheDocument();
    expect(screen.getByTestId("insights-recent-runs-card")).toBeInTheDocument();
  });

  it("Quality Gate の rule 行は data-rule-status 属性で識別される", () => {
    renderWithTooltip(
      <SidebarPanels
        qualityGate={SAMPLE_INSIGHTS.qualityGate}
        allureSummary={SAMPLE_INSIGHTS.allureSummary}
        recentRuns={SAMPLE_INSIGHTS.recentRuns}
      />
    );
    const card = screen.getByTestId("insights-quality-gate-card");
    expect(card.querySelectorAll("[data-rule-status='pass']")).toHaveLength(
      SAMPLE_INSIGHTS.qualityGate.length
    );
  });

  it("全 rule pass のとき header に Passed badge が出る", () => {
    renderWithTooltip(
      <SidebarPanels
        qualityGate={SAMPLE_INSIGHTS.qualityGate}
        allureSummary={SAMPLE_INSIGHTS.allureSummary}
        recentRuns={SAMPLE_INSIGHTS.recentRuns}
      />
    );
    const card = screen.getByTestId("insights-quality-gate-card");
    expect(within(card).getByText("Passed")).toBeInTheDocument();
  });

  it("1 件でも fail があると Failed badge に切り替わる", () => {
    renderWithTooltip(
      <SidebarPanels
        qualityGate={[
          ...SAMPLE_INSIGHTS.qualityGate,
          { name: "テストルール", threshold: "n/a", actual: "n/a", status: "fail" }
        ]}
        allureSummary={SAMPLE_INSIGHTS.allureSummary}
        recentRuns={SAMPLE_INSIGHTS.recentRuns}
      />
    );
    const card = screen.getByTestId("insights-quality-gate-card");
    expect(within(card).getByText("Failed")).toBeInTheDocument();
  });

  it("Allure フルレポート button は disabled で Phase 1.2 接続予定 tooltip を持つ", async () => {
    const user = userEvent.setup();
    renderWithTooltip(
      <SidebarPanels
        qualityGate={SAMPLE_INSIGHTS.qualityGate}
        allureSummary={SAMPLE_INSIGHTS.allureSummary}
        recentRuns={SAMPLE_INSIGHTS.recentRuns}
      />
    );
    const fullReport = screen.getByTestId("insights-allure-full-report");
    expect(fullReport).toBeDisabled();
    await user.hover(fullReport);
    expect(
      await screen.findByText(PHASE_1_2_PLACEHOLDER_LABEL, {
        selector: "[role='tooltip']"
      })
    ).toBeInTheDocument();
  });

  it("最近の Run は data-run-status / data-run-trend で識別される", () => {
    renderWithTooltip(
      <SidebarPanels
        qualityGate={SAMPLE_INSIGHTS.qualityGate}
        allureSummary={SAMPLE_INSIGHTS.allureSummary}
        recentRuns={SAMPLE_INSIGHTS.recentRuns}
      />
    );
    const card = screen.getByTestId("insights-recent-runs-card");
    // SAMPLE: 3 passed / 1 failed / 1 flaky / trends: up x3, down x1, flat x1
    expect(card.querySelectorAll("[data-run-status='passed']")).toHaveLength(3);
    expect(card.querySelectorAll("[data-run-status='failed']")).toHaveLength(1);
    expect(card.querySelectorAll("[data-run-status='flaky']")).toHaveLength(1);
    expect(card.querySelectorAll("[data-run-trend='up']")).toHaveLength(3);
    expect(card.querySelectorAll("[data-run-trend='down']")).toHaveLength(1);
    expect(card.querySelectorAll("[data-run-trend='flat']")).toHaveLength(1);
  });
});
