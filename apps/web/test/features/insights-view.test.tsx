// Insights View placeholder の rendering tests (Issue #13 acceptance)。
//
// pin する内容:
//  - 4 main セクション (Hero / 3-card row / AI summary / Sidebar) が DOM に存在
//  - "Phase 5+ で接続予定" badge 数 (未接続 card を Phase 1.2 完了後も
//    badge を外し忘れた / 接続済 card に badge が残ったままの regression を検出)
//  - heading 階層: h2 (Hero "Release Readiness") + 各 card の h3
//    (h1 は app-shell の TopBar Brand 内に存在し、本 view test の責務外)
//  - "すべて表示" / "フルレポート" は disabled button + tooltip "Phase 5+ で接続予定"
//  - Hero の progress bar が aria-valuemin/valuemax/valuenow を持ち NaN/Infinity を 0 に丸める
//  - data-verdict / data-rule-status / data-run-status / data-run-trend で test を class 文字列に couple させない
//  - 各 Card Props を空配列で override しても crash しない (defensive rendering)
import { afterEach, describe, expect, it, vi } from "vitest";
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
  DEFERRED_PLACEHOLDER_LABEL
} from "@/features/insights-view/types";
import { TooltipProvider } from "@/components/ui/tooltip";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

  it("heading 階層が h2 (Hero) → h3 (各 card 7 件) で構造化される", () => {
    // app-shell の TopBar Brand が h1 ("Playwright Workbench") を持つため、本 view 内の
    // entry heading は h2 (Hero "Release Readiness") から始まる。各 card は h3 で 7 件
    // (3 main cards: Critical / Known / Flaky + AI summary + 3 sidebar: Quality Gate / Allure / Recent runs)。
    render(<InsightsView summary={SAMPLE_INSIGHTS} />);
    // h2: Hero "Release Readiness"
    expect(
      screen.getByRole("heading", { level: 2, name: INSIGHTS_VIEW_LABELS.hero })
    ).toBeInTheDocument();
    // h3: 7 件
    const h3s = screen.getAllByRole("heading", { level: 3 });
    expect(h3s).toHaveLength(7);
  });

  it("Phase 5+ で接続予定 badge が 3 つ visible で存在する (Known / Flaky / AI のみ)", () => {
    // §1.2 で Hero / Critical Failures は実データ wire 済のため badge 撤去。
    // 残るのは Known Issues (1) + Top Flaky (1) + AI (1) = 3。
    // sidebar (Allure / RecentRuns) の同 label は Tooltip content として
    // portal 経由で開いた時のみ DOM に現れるため、本 visible-only assertion からは外れる。
    // 個別の sidebar tooltip 動作は SidebarPanels describe ブロックで pin する。
    render(<InsightsView summary={SAMPLE_INSIGHTS} />);
    const badges = screen.getAllByText(DEFERRED_PLACEHOLDER_LABEL);
    expect(badges).toHaveLength(3);
  });
});

describe("InsightsHero", () => {
  it("score / verdict badge / progress bar (aria-valuemin/max/now) / 5 stats を描画する", () => {
    renderWithTooltip(
      <InsightsHero
        readiness={SAMPLE_INSIGHTS.readiness}
        stats={SAMPLE_INSIGHTS.stats}
      />
    );
    const hero = screen.getByTestId("insights-hero");
    expect(within(hero).getByText("86")).toBeInTheDocument();
    expect(within(hero).getByText("/ 100")).toBeInTheDocument();
    expect(within(hero).getByText("Ready")).toBeInTheDocument();
    // progress bar の 3 属性すべて pin
    const progressBar = within(hero).getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuemin", "0");
    expect(progressBar).toHaveAttribute("aria-valuemax", "100");
    expect(progressBar).toHaveAttribute("aria-valuenow", "86");
    // 5 stats が定義順 (Total / Passed / Failed / Flaky / Skipped) で並ぶ
    const statLabels = hero.querySelectorAll("[data-stat-label]");
    expect(
      Array.from(statLabels).map((el) => el.getAttribute("data-stat-label"))
    ).toEqual(["Total", "Passed", "Failed", "Flaky", "Skipped"]);
    expect(within(hero).getByText("2,842")).toBeInTheDocument();
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

  it("score=NaN / Infinity は 0 として扱われ aria-valuenow が 'NaN' で壊れない + console.error が残る", () => {
    // silent failure 防衛: API/AI が非 finite な数値を返した時に UI が「0 と区別不能」で
    // silent に偽装されないよう、console.error で痕跡を残す invariant を pin。
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderWithTooltip(
      <InsightsHero
        readiness={{ score: NaN, verdict: "not-ready", versionLabel: "v1.0", description: "" }}
        stats={SAMPLE_INSIGHTS.stats}
      />
    );
    const bar1 = screen.getByRole("progressbar");
    expect(bar1).toHaveAttribute("aria-valuenow", "0");
    expect(bar1.getAttribute("aria-valuenow")).not.toBe("NaN");

    cleanup();

    renderWithTooltip(
      <InsightsHero
        readiness={{
          score: Number.POSITIVE_INFINITY,
          verdict: "ready",
          versionLabel: "v1.0",
          description: ""
        }}
        stats={SAMPLE_INSIGHTS.stats}
      />
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

    expect(consoleSpy).toHaveBeenCalledWith(
      "[InsightsHero] readiness.score is not a finite number",
      expect.anything()
    );
  });

  it("verdict 3 種 (ready / conditional / not-ready) すべてが data-verdict で pin される", () => {
    const verdicts: ReadonlyArray<{ value: "ready" | "conditional" | "not-ready"; label: string }> = [
      { value: "ready", label: "Ready" },
      { value: "conditional", label: "Conditional" },
      { value: "not-ready", label: "Not Ready" }
    ];
    for (const { value, label } of verdicts) {
      cleanup();
      renderWithTooltip(
        <InsightsHero
          readiness={{
            score: 50,
            verdict: value,
            versionLabel: "v1.0",
            description: "test"
          }}
          stats={SAMPLE_INSIGHTS.stats}
        />
      );
      const verdictBadge = screen.getByText(label);
      expect(verdictBadge).toHaveAttribute("data-verdict", value);
    }
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
      await screen.findByText(DEFERRED_PLACEHOLDER_LABEL, {
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
        qualityGateStatus={SAMPLE_INSIGHTS.qualityGateStatus}
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
        qualityGateStatus={SAMPLE_INSIGHTS.qualityGateStatus}
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
        qualityGateStatus={SAMPLE_INSIGHTS.qualityGateStatus}
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
        qualityGateStatus="failed"
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

  it("未評価で rule が空のとき Passed を表示しない", () => {
    renderWithTooltip(
      <SidebarPanels
        qualityGateStatus="not-evaluated"
        qualityGate={[]}
        allureSummary={SAMPLE_INSIGHTS.allureSummary}
        recentRuns={SAMPLE_INSIGHTS.recentRuns}
      />
    );
    const card = screen.getByTestId("insights-quality-gate-card");
    expect(within(card).getByText("Not evaluated")).toBeInTheDocument();
    expect(within(card).getByText("Quality Gate not evaluated.")).toBeInTheDocument();
    expect(within(card).queryByText("Passed")).not.toBeInTheDocument();
  });

  it("評価済みで rule 明細が空のとき未評価とは表示しない", () => {
    renderWithTooltip(
      <SidebarPanels
        qualityGateStatus="passed"
        qualityGate={[]}
        allureSummary={SAMPLE_INSIGHTS.allureSummary}
        recentRuns={SAMPLE_INSIGHTS.recentRuns}
      />
    );
    const card = screen.getByTestId("insights-quality-gate-card");
    expect(within(card).getByText("Passed")).toBeInTheDocument();
    expect(
      within(card).getByText("Quality Gate evaluated; rule details are not available.")
    ).toBeInTheDocument();
    expect(within(card).queryByText("Quality Gate not evaluated.")).not.toBeInTheDocument();
  });

  it("Allure フルレポート button は disabled で Phase 1.2 接続予定 tooltip を持つ", async () => {
    const user = userEvent.setup();
    renderWithTooltip(
      <SidebarPanels
        qualityGateStatus={SAMPLE_INSIGHTS.qualityGateStatus}
        qualityGate={SAMPLE_INSIGHTS.qualityGate}
        allureSummary={SAMPLE_INSIGHTS.allureSummary}
        recentRuns={SAMPLE_INSIGHTS.recentRuns}
      />
    );
    const fullReport = screen.getByTestId("insights-allure-full-report");
    expect(fullReport).toBeDisabled();
    await user.hover(fullReport);
    expect(
      await screen.findByText(DEFERRED_PLACEHOLDER_LABEL, {
        selector: "[role='tooltip']"
      })
    ).toBeInTheDocument();
  });

  it("最近の Run の \"すべて表示\" button も disabled で Phase 1.2 接続予定 tooltip を持つ", async () => {
    // Phase 1.2 で sidebar の placeholder を外し忘れた regression を pin する。
    // Allure と同じ contract で動くことを確認。
    const user = userEvent.setup();
    renderWithTooltip(
      <SidebarPanels
        qualityGateStatus={SAMPLE_INSIGHTS.qualityGateStatus}
        qualityGate={SAMPLE_INSIGHTS.qualityGate}
        allureSummary={SAMPLE_INSIGHTS.allureSummary}
        recentRuns={SAMPLE_INSIGHTS.recentRuns}
      />
    );
    const showAll = screen.getByTestId("insights-recent-runs-show-all");
    expect(showAll).toBeDisabled();
    await user.hover(showAll);
    expect(
      await screen.findByText(DEFERRED_PLACEHOLDER_LABEL, {
        selector: "[role='tooltip']"
      })
    ).toBeInTheDocument();
  });

  it("最近の Run は data-run-status / data-run-trend で識別される", () => {
    renderWithTooltip(
      <SidebarPanels
        qualityGateStatus={SAMPLE_INSIGHTS.qualityGateStatus}
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
