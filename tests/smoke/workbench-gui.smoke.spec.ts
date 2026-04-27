/**
 * Manual GUI smoke (Phase 1 acceptance §32).
 *
 * Drives the Workbench GUI through Playwright to verify the end-to-end
 * surface that unit + integration tests cannot reach: the React shell,
 * TanStack Query plumbing, the project open form, and the inventory render.
 * This spec lives outside the workspace test suite — it is launched
 * out-of-band against an already-running `pnpm dev:agent` + `pnpm preview`.
 *
 * δ (Issue #11) で QA View が Tailwind/shadcn 化されたため、UI 文字列の
 * 検証ポイントを新 design system に合わせて更新している:
 *  - "Playwright Workbench" は h1 ではなく Brand コンポーネント (div) に移った
 *  - "Open" は shadcn Button (role=button, name="Open")
 *  - "Ready" は ProjectPicker の Badge (text 検索で十分)
 *  - StatusBar に WebSocket 接続状態 ("WS · Connected" 等) が常時表示される
 */
import { test, expect } from "@playwright/test";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKBENCH_URL = process.env.WORKBENCH_URL ?? "http://127.0.0.1:5173";
const FIXTURE = process.env.FIXTURE_ROOT ?? path.resolve(here, "../fixtures/sample-pw-project");
const ARTIFACT_DIR = path.resolve(here, "_artifacts");

test("Workbench GUI: open project + render inventory", async ({ page }) => {
  await page.goto(WORKBENCH_URL);

  // ブランド表記 (TopBar/Brand コンポーネント)
  await expect(page.getByText("Playwright Workbench").first()).toBeVisible();
  // StatusBar の Agent v... 表示 (Agent 起動を確認)
  await expect(page.getByText(/Agent v/)).toBeVisible({ timeout: 10_000 });
  // δ で追加: WS 接続状態が StatusBar に表示される
  await expect(page.getByText(/WS · /)).toBeVisible({ timeout: 10_000 });

  // ProjectPicker
  await page
    .getByLabel("Absolute path to a Playwright project")
    .fill(FIXTURE);
  await page.getByRole("button", { name: "Open" }).click();

  // ProjectFacts > Status badge ("Ready") + PM 表示 ("pnpm")
  await expect(page.getByText("Ready")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("pnpm").first()).toBeVisible();

  // TestInventoryPanel に spec/test が表示される
  await expect(page.getByText("tests/example.spec.ts")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("trivial passing assertion")).toBeVisible();

  await page.screenshot({ path: path.join(ARTIFACT_DIR, "gui-smoke.png"), fullPage: true });
});
