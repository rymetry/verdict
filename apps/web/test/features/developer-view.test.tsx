// Developer View placeholder の rendering tests (Issue #12 acceptance)。
//
// 何を pin するか:
//  - 4 つの placeholder card が DOM に存在し、`Phase 1.2 で接続予定` バッジを持つ
//  - File tree のグループ + アイテム件数が sample data と一致
//  - Source tabs の 3 タブ (ソース / 差分 / ターミナル) が ARIA tablist として機能
//  - Inspector panel の 3 サブカード (Locator / Console / Run metadata) が表示される
//  - 各 Card は静的サンプルデータを持ち、Phase 1.2 で props 差し替えできる
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
  DEVELOPER_VIEW_LABELS,
  PHASE_1_2_PLACEHOLDER_LABEL,
  SAMPLE_FILE_TREE
} from "@/features/developer-view/sample-data";

afterEach(() => {
  cleanup();
});

describe("DeveloperView (3-col composer)", () => {
  it("3 つの主要カラム (file-tree / source-tabs / inspector) を同時に描画する", () => {
    render(<DeveloperView />);
    expect(screen.getByTestId("dev-view-grid")).toBeInTheDocument();
    expect(screen.getByTestId("dev-file-tree-card")).toBeInTheDocument();
    expect(screen.getByTestId("dev-source-tabs-card")).toBeInTheDocument();
    expect(screen.getByTestId("dev-inspector-panel")).toBeInTheDocument();
  });

  it("Phase 1.2 で接続予定 badge が 5 つ存在する (4 main card + Inspector の 3 サブ = 5)", () => {
    // FileTree / SourceTabs / Locator / Console / RunMetadata の合計 5 箇所に Phase バッジが付く。
    // バッジ数を pin することで「Phase 1.2 で実データ化した時に外し忘れた」regression を検出できる。
    render(<DeveloperView />);
    const badges = screen.getAllByText(PHASE_1_2_PLACEHOLDER_LABEL);
    expect(badges).toHaveLength(5);
  });
});

describe("FileTreeCard", () => {
  it("グループとアイテム件数の合計を header に表示する", () => {
    render(<FileTreeCard />);
    const total = SAMPLE_FILE_TREE.reduce((acc, g) => acc + g.items.length, 0);
    const card = screen.getByTestId("dev-file-tree-card");
    expect(within(card).getByText(String(total))).toBeInTheDocument();
  });

  it("失敗 spec は Failed バッジ付きで描画される", () => {
    render(<FileTreeCard />);
    // `failed: true` のアイテム数 (sample-data 上は 2 件)
    const failedItems = SAMPLE_FILE_TREE.flatMap((g) => g.items).filter((i) => i.failed);
    expect(failedItems.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed")).toHaveLength(failedItems.length);
  });

  it("annotation (Page Object / Fixture / Config) が表示される", () => {
    render(<FileTreeCard />);
    expect(screen.getByText("Page Object")).toBeInTheDocument();
    expect(screen.getByText("Fixture")).toBeInTheDocument();
    expect(screen.getByText("Config")).toBeInTheDocument();
  });

  it("current item は aria-current=true を持つ", () => {
    render(<FileTreeCard />);
    const card = screen.getByTestId("dev-file-tree-card");
    const currentItems = card.querySelectorAll("[aria-current='true']");
    expect(currentItems.length).toBe(1);
    expect(currentItems[0].textContent).toContain("checkout.spec.ts");
  });

  it("groups Props が空配列のとき総数 0 で描画される (Phase 1.2 で空状態テスト用)", () => {
    render(<FileTreeCard groups={[]} />);
    const card = screen.getByTestId("dev-file-tree-card");
    expect(within(card).getByText("0")).toBeInTheDocument();
  });
});

describe("SourceTabsCard", () => {
  it("3 つのタブ (ソース / 差分 / ターミナル) を tablist として描画する", () => {
    render(<SourceTabsCard />);
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
    render(<SourceTabsCard />);
    expect(screen.getByRole("tab", { name: DEVELOPER_VIEW_LABELS.source })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("差分タブをクリックすると diff サンプルの追加 / 削除行が表示される", async () => {
    const user = userEvent.setup();
    render(<SourceTabsCard />);
    await user.click(screen.getByRole("tab", { name: DEVELOPER_VIEW_LABELS.diff }));
    // diff sample 内の追加行
    expect(
      screen.getByText("await page.waitForLoadState('networkidle');")
    ).toBeInTheDocument();
  });

  it("ターミナルタブをクリックすると static stdout が描画される", async () => {
    const user = userEvent.setup();
    render(<SourceTabsCard />);
    await user.click(screen.getByRole("tab", { name: DEVELOPER_VIEW_LABELS.terminal }));
    // sample terminal 内の特徴的な文字列
    expect(
      screen.getByText(/Error: expect\(locator\)\.toBeVisible\(\)/)
    ).toBeInTheDocument();
  });

  it("失敗行は背景色で強調表示される (state=fail)", () => {
    render(<SourceTabsCard />);
    // 失敗行のテキスト一部 (line 87) を含む要素を取得し、fail 用クラスが付いていることを確認
    const failLineText = screen.getByText(/await expect\(page\.getByRole\('button'/);
    // 親要素の class に `bg-[var(--fail-soft)]` が含まれること
    expect(failLineText.parentElement?.className ?? "").toMatch(/bg-\[var\(--fail-soft\)\]/);
  });
});

describe("InspectorPanel", () => {
  it("3 サブカード (locator / console / run-metadata) を縦積みで描画する", () => {
    render(<InspectorPanel />);
    expect(screen.getByTestId("dev-locator-card")).toBeInTheDocument();
    expect(screen.getByTestId("dev-console-card")).toBeInTheDocument();
    expect(screen.getByTestId("dev-run-metadata-card")).toBeInTheDocument();
  });

  it("Locator card は expression と miss/ok 状態の rows を表示する", () => {
    render(<InspectorPanel />);
    const card = screen.getByTestId("dev-locator-card");
    expect(within(card).getByText(/getByRole\('button'/)).toBeInTheDocument();
    expect(within(card).getAllByText("hidden").length).toBeGreaterThan(0);
    expect(within(card).getByText("disabled")).toBeInTheDocument();
  });

  it("Console card は warn / error / info の各 level を Badge で描画する", () => {
    render(<InspectorPanel />);
    const card = screen.getByTestId("dev-console-card");
    expect(within(card).getByText("warn")).toBeInTheDocument();
    expect(within(card).getByText("error")).toBeInTheDocument();
    expect(within(card).getByText("info")).toBeInTheDocument();
  });

  it("Run metadata card は dl/dt/dd で 6 行のメタを表示する", () => {
    render(<InspectorPanel />);
    const card = screen.getByTestId("dev-run-metadata-card");
    // sample data の項目を最低 1 つずつ pin
    expect(within(card).getByText("Run ID")).toBeInTheDocument();
    expect(within(card).getByText("Branch")).toBeInTheDocument();
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
    // rows が空のとき hidden / disabled は出ない
    expect(within(card).queryByText("hidden")).not.toBeInTheDocument();
  });
});
