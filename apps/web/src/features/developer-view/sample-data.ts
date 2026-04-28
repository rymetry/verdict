// Developer View placeholder の静的サンプルデータ。
//
// なぜ静的か:
//  - Issue #12 (ε) は Phase 1 placeholder として「Phase 1.2 で接続予定」のスケルトンを置くこと。
//    実データ (inventory / run / locator / console) は Phase 1.2 以降のスコープ。
//  - 表示構造を凍結 (pin) するため、テストは確定値で assert できる必要がある。
//
// Phase 1.2 で実装する際の置換ポイント:
//  - FileTree: GET /projects/:id/inventory + Failure detail の関連ファイル + Git status から組成
//  - Source/Diff/Terminal: GET /runs/:runId/source (現状未定義) または現状の logs から派生
//  - Locator: ts-morph (Phase 5/7) ベースの解析 or `playwright test --debug` 出力
//  - Console: WebSocket `run.stdout/stderr` ストリーム (run-console と共通源)
//  - RunMetadata: GET /runs/:runId (run metadata) — 既存 endpoint をそのまま再利用可

export interface FileTreeGroup {
  /** ディレクトリ名 (見出し用)。trailing slash は表示時に付与する */
  readonly path: string;
  readonly items: ReadonlyArray<FileTreeItem>;
}

export interface FileTreeItem {
  readonly name: string;
  /** 現在 active な file (failure 中の spec など) を強調表示する */
  readonly current?: boolean;
  /** 失敗状態 (spec ファイル) */
  readonly failed?: boolean;
  /** Page Object / Fixture / Config 等の補足ラベル */
  readonly annotation?: string;
}

export const SAMPLE_FILE_TREE: ReadonlyArray<FileTreeGroup> = [
  {
    path: "tests/checkout",
    items: [
      { name: "checkout.spec.ts", current: true, failed: true },
      { name: "promo.spec.ts", failed: true }
    ]
  },
  {
    path: "pages",
    items: [{ name: "checkout.page.ts", annotation: "Page Object" }]
  },
  {
    path: "fixtures",
    items: [{ name: "checkout.fixture.ts", annotation: "Fixture" }]
  },
  {
    path: "config",
    items: [{ name: "playwright.config.ts", annotation: "Config" }]
  }
];

export interface SourceLine {
  /** 行番号表示 (- / + は diff 用なので string) */
  readonly lineNo: string;
  /** プレーンテキスト (シンタックスハイライトは Phase 1.2 で Monaco に委譲) */
  readonly text: string;
  readonly state?: "fail" | "added" | "removed";
}

export const SAMPLE_SOURCE: ReadonlyArray<SourceLine> = [
  { lineNo: "82", text: "  test('should complete purchase', async ({ page }) => {" },
  { lineNo: "83", text: "    await page.goto('/checkout');" },
  { lineNo: "84", text: "    await fillShipping(page);" },
  { lineNo: "85", text: "    await selectShipping(page, 'standard');" },
  { lineNo: "86", text: "    await fillPayment(page, validCard);" },
  {
    lineNo: "87",
    text: "    await expect(page.getByRole('button', { name: 'Place Order' })).toBeVisible();",
    state: "fail"
  },
  { lineNo: "88", text: "    await page.getByRole('button', { name: 'Place Order' }).click();" },
  { lineNo: "89", text: "    await expect(page.getByText('Order confirmed')).toBeVisible();" },
  { lineNo: "90", text: "  });" }
];

export const SAMPLE_DIFF: ReadonlyArray<SourceLine> = [
  { lineNo: "−", text: "    await fillPayment(page);", state: "removed" },
  { lineNo: "+", text: "    await fillPayment(page, validCard);", state: "added" },
  {
    lineNo: "+",
    text: "    await page.waitForLoadState('networkidle');",
    state: "added"
  }
];

export const SAMPLE_TERMINAL = [
  "$ pnpm exec playwright test tests/checkout/checkout.spec.ts:87",
  "Running 1 test using 1 worker",
  "",
  "  ✘ checkout > should complete purchase (chromium) 18.7s",
  "",
  "  at tests/checkout/checkout.spec.ts:87",
  "  Error: expect(locator).toBeVisible()",
  "",
  "  Locator: getByRole('button', { name: 'Place Order' })",
  "  Expected: visible",
  "  Received: hidden  (disabled attribute)",
  "  Timeout:  5000ms"
] as const;

export interface LocatorRow {
  readonly key: string;
  readonly value: string;
  readonly status?: "ok" | "miss";
}

export const SAMPLE_LOCATOR = {
  expression: "getByRole('button', { name: 'Place Order' })",
  rows: [
    { key: "解決", value: "button.btn.btn-primary.place-order" },
    { key: "visible", value: "hidden", status: "miss" as const },
    { key: "enabled", value: "disabled", status: "miss" as const },
    { key: "matched", value: "1 element", status: "ok" as const },
    { key: "tagName", value: "button" },
    { key: "data-testid", value: "place-order" }
  ] satisfies ReadonlyArray<LocatorRow>
} as const;

export interface ConsoleEntry {
  readonly timestamp: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

export const SAMPLE_CONSOLE: ReadonlyArray<ConsoleEntry> = [
  {
    timestamp: "+12.34s",
    level: "warn",
    message: "[checkout] form validation failed: card_number_expired"
  },
  {
    timestamp: "+13.10s",
    level: "error",
    message: "POST /api/orders 500 Internal Server Error"
  },
  {
    timestamp: "+13.45s",
    level: "info",
    message: "[checkout] place_order_button_disabled = true"
  }
];

export const SAMPLE_RUN_METADATA: ReadonlyArray<readonly [string, string]> = [
  ["Run ID", "run_2024-05-18_10-24-31"],
  ["Branch", "main · a1b2c3d"],
  ["Commit", "fix: cart totals rounding"],
  ["Worker", "2 / 4"],
  ["OS", "macOS 14.4"],
  ["Browser", "chromium 124"]
];

// Phase 1.2 接続予定 badge を表現するための constant。
// 文字列を一箇所に集約し、Phase 1.2 で実データに切り替える際の grep 起点を作る。
export const PHASE_1_2_PLACEHOLDER_LABEL = "Phase 1.2 で接続予定";

// Card 個別のキャプション (UI 文言) も Phase 1.2 移行時の grep 容易性のため同居させる。
export const DEVELOPER_VIEW_LABELS = {
  fileTree: "関連ファイル",
  sourceTabs: "ソース",
  inspector: "検証",
  source: "ソース",
  diff: "差分",
  terminal: "ターミナル",
  locator: "Locator (失敗時の状態)",
  console: "Console (失敗中の出力)",
  runMetadata: "Run メタデータ"
} as const;

export type DeveloperViewLabel = keyof typeof DEVELOPER_VIEW_LABELS;
