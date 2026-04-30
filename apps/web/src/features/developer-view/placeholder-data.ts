// Developer View 静的サンプルデータ (Phase 5+ までの placeholder)。
//
// Developer View の各 sub panel (FileTree / SourceTabs / Locator /
// Console / RunMetadata) は Phase 5+ で実データに wire 予定 (PLAN.v2
// §24)。それまでは本ファイルの SAMPLE_* fixture を route から渡し、
// 各 Card Props を required にすることで silent fallback を防いでいる。
//
// Phase 5+ で実データに切り替える際の手順:
//  - `routes/dev.tsx` から本ファイルの import を削除し、各 Card Props
//    に hook 戻り値を直接渡す (`data ?? SAMPLE_*` の fallback は禁止)。
//  - `DEFERRED_PLACEHOLDER_LABEL` (types.ts) を grep 起点に各 badge を
//    検証 (wire 済 panel の badge を消し、未接続 panel は残す)。
//  - 本ファイル自身は test fixture として残してよい (component test 用)。
import type {
  ConsoleEntry,
  FileTreeGroup,
  LocatorState,
  RunMetadataRow,
  SourceLine
} from "./types";

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

// diff の lineNo は ASCII `-` / `+` で表現する (unified diff 慣例)。
// 行番号 (`+` / `-`) が複数出現するため、render 側で key に index を組み合わせる必要がある。
export const SAMPLE_DIFF: ReadonlyArray<SourceLine> = [
  { lineNo: "-", text: "    await fillPayment(page);", state: "removed" },
  { lineNo: "+", text: "    await fillPayment(page, validCard);", state: "added" },
  {
    lineNo: "+",
    text: "    await page.waitForLoadState('networkidle');",
    state: "added"
  }
];

export const SAMPLE_TERMINAL: ReadonlyArray<string> = [
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
];

export const SAMPLE_LOCATOR: LocatorState = {
  expression: "getByRole('button', { name: 'Place Order' })",
  rows: [
    { key: "解決", value: "button.btn.btn-primary.place-order" },
    { key: "visible", value: "hidden", status: "miss" },
    { key: "enabled", value: "disabled", status: "miss" },
    { key: "matched", value: "1 element", status: "ok" },
    { key: "tagName", value: "button" },
    { key: "data-testid", value: "place-order" }
  ]
};

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

export const SAMPLE_RUN_METADATA: ReadonlyArray<RunMetadataRow> = [
  ["Run ID", "run_2024-05-18_10-24-31"],
  ["Branch", "main · a1b2c3d"],
  ["Commit", "fix: cart totals rounding"],
  ["Worker", "2 / 4"],
  ["OS", "macOS 14.4"],
  ["Browser", "chromium 124"]
];
