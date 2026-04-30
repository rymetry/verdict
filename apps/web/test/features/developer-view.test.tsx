// Developer View placeholder の rendering tests (Issue #12 acceptance)。
//
// 何を pin するか:
//  - 4 つの placeholder card が DOM に存在し、`Phase 1.2 で接続予定` バッジを持つ
//  - File tree のグループ + アイテム件数が placeholder data と一致
//  - Source tabs の 3 タブ (ソース / 差分 / ターミナル) が ARIA tablist として機能
//  - Diff の added / removed / fail 行は data-line-state attribute で識別される
//  - Inspector panel の 3 サブカード (Locator / Console / Run metadata) が表示される
//  - 各 Card は required props を受け取り、override も pass-through で動く
//
// ε のスコープでは behavioral test (実 API 接続 / event 駆動) は不要。Phase 1.2 で実装する。
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DeveloperView } from "@/features/developer-view/DeveloperView";
import { FileTreeCard } from "@/features/developer-view/FileTreeCard";
import { InspectorPanel } from "@/features/developer-view/InspectorPanel";
import { SourceTabsCard } from "@/features/developer-view/SourceTabsCard";
import {
  SAMPLE_CONSOLE,
  SAMPLE_DIFF,
  SAMPLE_FILE_TREE,
  SAMPLE_LOCATOR,
  SAMPLE_RUN_METADATA,
  SAMPLE_SOURCE,
  SAMPLE_TERMINAL
} from "@/features/developer-view/placeholder-data";
import {
  DEVELOPER_VIEW_LABELS,
  DEFERRED_PLACEHOLDER_LABEL
} from "@/features/developer-view/types";

afterEach(() => {
  cleanup();
});

// 全 Card に placeholder data を一括で注入するヘルパ。Phase 1.2 で本物の data に切替える際は
// この helper の各 prop を `useQuery` の結果に置換する。
function renderDeveloperViewWithSample(): void {
  render(
    <DeveloperView
      fileTreeGroups={SAMPLE_FILE_TREE}
      source={SAMPLE_SOURCE}
      diff={SAMPLE_DIFF}
      terminal={SAMPLE_TERMINAL}
      locator={SAMPLE_LOCATOR}
      consoleEntries={SAMPLE_CONSOLE}
      runMetadata={SAMPLE_RUN_METADATA}
    />
  );
}

describe("DeveloperView (3-col composer)", () => {
  it("3 つの主要カラム (file-tree / source-tabs / inspector) を同時に描画する", () => {
    renderDeveloperViewWithSample();
    expect(screen.getByTestId("dev-view-grid")).toBeInTheDocument();
    expect(screen.getByTestId("dev-file-tree-card")).toBeInTheDocument();
    expect(screen.getByTestId("dev-source-tabs-card")).toBeInTheDocument();
    expect(screen.getByTestId("dev-inspector-panel")).toBeInTheDocument();
  });

  it("Phase 5+ で接続予定 badge が 5 つ存在する (FileTree + SourceTabs + Locator + Console + RunMetadata)", () => {
    // バッジ数を pin することで「実データに wire した時に外し忘れた」regression を検出できる。
    // Developer View の 5 サブパネルはすべて Phase 5+ で wire 予定 (ts-morph 由来 Locator,
    // browser console filter 等)、現状はすべて static placeholder のまま。
    // 内訳: FileTree (1) + SourceTabs (1) + Locator (1) + Console (1) + RunMetadata (1) = 5。
    // Inspector panel root には badge は付かない。
    renderDeveloperViewWithSample();
    const badges = screen.getAllByText(DEFERRED_PLACEHOLDER_LABEL);
    expect(badges).toHaveLength(5);
  });
});

describe("FileTreeCard", () => {
  it("グループとアイテム件数の合計を header に表示する", () => {
    render(<FileTreeCard groups={SAMPLE_FILE_TREE} />);
    const total = SAMPLE_FILE_TREE.reduce((acc, g) => acc + g.items.length, 0);
    const card = screen.getByTestId("dev-file-tree-card");
    expect(within(card).getByText(String(total))).toBeInTheDocument();
  });

  it("失敗 spec は Failed バッジ付きで描画される", () => {
    render(<FileTreeCard groups={SAMPLE_FILE_TREE} />);
    const failedItems = SAMPLE_FILE_TREE.flatMap((g) => g.items).filter((i) => i.failed);
    expect(failedItems.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed")).toHaveLength(failedItems.length);
  });

  it("annotation (Page Object / Fixture / Config) が表示される", () => {
    render(<FileTreeCard groups={SAMPLE_FILE_TREE} />);
    expect(screen.getByText("Page Object")).toBeInTheDocument();
    expect(screen.getByText("Fixture")).toBeInTheDocument();
    expect(screen.getByText("Config")).toBeInTheDocument();
  });

  it("current item は aria-current=location を持つ (WAI-ARIA 1.2 準拠)", () => {
    render(<FileTreeCard groups={SAMPLE_FILE_TREE} />);
    const card = screen.getByTestId("dev-file-tree-card");
    // 値非依存で `[aria-current]` selector を使い、location → "page" 等への将来変更にも耐える
    const currentItems = card.querySelectorAll("[aria-current]");
    expect(currentItems.length).toBe(1);
    expect(currentItems[0]).toHaveAttribute("aria-current", "location");
    expect(currentItems[0].textContent).toContain("checkout.spec.ts");
  });

  it("groups Props が空配列でも crash せず総数 0 を表示する", () => {
    // 注: Phase 1.2 では loading / error / empty を呼び出し側で分岐する設計。
    //     このテストは Component の defensive rendering を pin するもので、
    //     Phase 1.2 では「empty data → 専用 empty state UI」へ責務移譲する。
    render(<FileTreeCard groups={[]} />);
    const card = screen.getByTestId("dev-file-tree-card");
    expect(within(card).getByText("0")).toBeInTheDocument();
  });
});

describe("SourceTabsCard", () => {
  it("3 つのタブ (ソース / 差分 / ターミナル) を tablist として描画する", () => {
    render(
      <SourceTabsCard
        source={SAMPLE_SOURCE}
        diff={SAMPLE_DIFF}
        terminal={SAMPLE_TERMINAL}
      />
    );
    const tablist = screen.getByRole("tablist");
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.textContent)).toEqual([
      DEVELOPER_VIEW_LABELS.source,
      DEVELOPER_VIEW_LABELS.diff,
      DEVELOPER_VIEW_LABELS.terminal
    ]);
  });

  it("初期状態では ソース タブが selected", () => {
    render(
      <SourceTabsCard
        source={SAMPLE_SOURCE}
        diff={SAMPLE_DIFF}
        terminal={SAMPLE_TERMINAL}
      />
    );
    expect(screen.getByRole("tab", { name: DEVELOPER_VIEW_LABELS.source })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("差分タブをクリックすると added / removed 両方の行が表示される (data-line-state で識別)", async () => {
    const user = userEvent.setup();
    render(
      <SourceTabsCard
        source={SAMPLE_SOURCE}
        diff={SAMPLE_DIFF}
        terminal={SAMPLE_TERMINAL}
      />
    );
    await user.click(screen.getByRole("tab", { name: DEVELOPER_VIEW_LABELS.diff }));

    // added 行
    expect(
      screen.getByText("await page.waitForLoadState('networkidle');")
    ).toBeInTheDocument();
    // removed 行
    expect(screen.getByText("await fillPayment(page);")).toBeInTheDocument();

    // data-line-state で added / removed を pin (class 文字列に依存しない)
    const diffRegion = screen.getByRole("region", { name: DEVELOPER_VIEW_LABELS.diff });
    expect(diffRegion.querySelectorAll("[data-line-state='added']")).toHaveLength(2);
    expect(diffRegion.querySelectorAll("[data-line-state='removed']")).toHaveLength(1);
  });

  it("ターミナルタブをクリックすると static stdout が描画される", async () => {
    const user = userEvent.setup();
    render(
      <SourceTabsCard
        source={SAMPLE_SOURCE}
        diff={SAMPLE_DIFF}
        terminal={SAMPLE_TERMINAL}
      />
    );
    await user.click(screen.getByRole("tab", { name: DEVELOPER_VIEW_LABELS.terminal }));
    expect(
      screen.getByText(/Error: expect\(locator\)\.toBeVisible\(\)/)
    ).toBeInTheDocument();
  });

  it("失敗行は data-line-state=fail を持つ (実装詳細の class 文字列に依存しない)", () => {
    render(
      <SourceTabsCard
        source={SAMPLE_SOURCE}
        diff={SAMPLE_DIFF}
        terminal={SAMPLE_TERMINAL}
      />
    );
    const sourceRegion = screen.getByRole("region", { name: DEVELOPER_VIEW_LABELS.source });
    expect(sourceRegion.querySelectorAll("[data-line-state='fail']")).toHaveLength(1);
  });

  it("terminal Props を空配列で渡すと出力エリアが空のまま描画される", async () => {
    // Phase 1.2 で stdout が来る前 (= 空配列) を「障害」と区別するための安全 pin。
    const user = userEvent.setup();
    render(<SourceTabsCard source={SAMPLE_SOURCE} diff={SAMPLE_DIFF} terminal={[]} />);
    await user.click(screen.getByRole("tab", { name: DEVELOPER_VIEW_LABELS.terminal }));
    const region = screen.getByRole("region", { name: DEVELOPER_VIEW_LABELS.terminal });
    expect(region).toBeEmptyDOMElement();
  });
});

describe("InspectorPanel", () => {
  it("3 サブカード (locator / console / run-metadata) を縦積みで描画する", () => {
    render(
      <InspectorPanel
        locator={SAMPLE_LOCATOR}
        consoleEntries={SAMPLE_CONSOLE}
        runMetadata={SAMPLE_RUN_METADATA}
      />
    );
    expect(screen.getByTestId("dev-locator-card")).toBeInTheDocument();
    expect(screen.getByTestId("dev-console-card")).toBeInTheDocument();
    expect(screen.getByTestId("dev-run-metadata-card")).toBeInTheDocument();
  });

  it("Locator card は expression と miss/ok 状態の rows を表示する", () => {
    render(
      <InspectorPanel
        locator={SAMPLE_LOCATOR}
        consoleEntries={SAMPLE_CONSOLE}
        runMetadata={SAMPLE_RUN_METADATA}
      />
    );
    const card = screen.getByTestId("dev-locator-card");
    expect(within(card).getByText(/getByRole\('button'/)).toBeInTheDocument();
    expect(within(card).getAllByText("hidden").length).toBeGreaterThan(0);
    expect(within(card).getByText("disabled")).toBeInTheDocument();
  });

  it("Console card は warn / error / info の各 level を Badge で描画する", () => {
    render(
      <InspectorPanel
        locator={SAMPLE_LOCATOR}
        consoleEntries={SAMPLE_CONSOLE}
        runMetadata={SAMPLE_RUN_METADATA}
      />
    );
    const card = screen.getByTestId("dev-console-card");
    expect(within(card).getByText("warn")).toBeInTheDocument();
    expect(within(card).getByText("error")).toBeInTheDocument();
    expect(within(card).getByText("info")).toBeInTheDocument();
  });

  it("Run metadata card は dt が SAMPLE_RUN_METADATA の行数と一致する", () => {
    render(
      <InspectorPanel
        locator={SAMPLE_LOCATOR}
        consoleEntries={SAMPLE_CONSOLE}
        runMetadata={SAMPLE_RUN_METADATA}
      />
    );
    const card = screen.getByTestId("dev-run-metadata-card");
    // 行数を pin: SAMPLE_RUN_METADATA に行を追加/削除した時の layout 想定崩れを検出
    expect(card.querySelectorAll("dt")).toHaveLength(SAMPLE_RUN_METADATA.length);
    expect(within(card).getByText("Run ID")).toBeInTheDocument();
    expect(within(card).getByText("chromium 124")).toBeInTheDocument();
  });

  it("locator props を空 rows で渡すと expression のみ表示される", () => {
    render(
      <InspectorPanel
        locator={{ expression: "page.getByText('foo')", rows: [] }}
        consoleEntries={[]}
        runMetadata={[]}
      />
    );
    const card = screen.getByTestId("dev-locator-card");
    expect(within(card).getByText("page.getByText('foo')")).toBeInTheDocument();
    expect(within(card).queryByText("hidden")).not.toBeInTheDocument();
  });
});
