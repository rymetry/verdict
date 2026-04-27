/**
 * Manual GUI smoke (Phase 1 acceptance §32).
 *
 * Drives the Workbench GUI through Playwright to verify the end-to-end
 * surface that unit + integration tests cannot reach: the React shell,
 * TanStack Query plumbing, the project open form, and the inventory render.
 * This spec lives outside the workspace test suite — it is launched
 * out-of-band against an already-running `pnpm dev:agent` + `pnpm preview`.
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

  await expect(page.getByRole("heading", { name: "Playwright Workbench" })).toBeVisible();
  await expect(page.getByText(/Agent v/)).toBeVisible({ timeout: 10_000 });

  await page
    .getByLabel("Absolute path to a Playwright project")
    .fill(FIXTURE);
  await page.getByRole("button", { name: "Open" }).click();

  await expect(page.getByText("Ready")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("pnpm")).toBeVisible();

  await expect(page.getByText("tests/example.spec.ts")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("trivial passing assertion")).toBeVisible();

  await page.screenshot({ path: path.join(ARTIFACT_DIR, "gui-smoke.png"), fullPage: true });
});
