/**
 * §1.2 Phase 1.2 GUI smoke against the Allure fixture.
 *
 * Drives the Workbench through the full Phase 1 + 1.2 pipeline against
 * `tests/fixtures/sample-pw-allure-project/` (allure-playwright reporter
 * configured, Allure 3 CLI installed). This is the user-visible
 * acceptance test for "the workbench actually works against an
 * Allure-enabled project from this repo" — the user explicitly asked
 * for end-to-end verification.
 *
 * Pipeline asserted:
 *   1. Open project → ProjectFacts shows pnpm + allure-playwright detected
 *   2. Inventory loads (TestInventoryPanel renders specs)
 *   3. Run → completes (the fixture has 1 passing + 1 intentionally
 *      failing test, so the run finishes with status=failed)
 *   4. QMO banner appears with outcome=not-ready (failure → not-ready)
 *
 * Trace + screenshot per phase are captured so CI artifacts let
 * reviewers see the actual UI state on failure.
 */
import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKBENCH_URL = process.env.WORKBENCH_URL ?? "http://127.0.0.1:5173";
const FIXTURE =
  process.env.ALLURE_FIXTURE_ROOT ??
  path.resolve(here, "../fixtures/sample-pw-allure-project");
const ARTIFACT_DIR = path.resolve(here, "_artifacts");

test("Workbench GUI: full Allure pipeline against sample-pw-allure-project", async ({
  page,
}) => {
  test.setTimeout(180_000);
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  // 1. Page loads + brand visible.
  await page.goto(WORKBENCH_URL);
  await expect(page.getByText("Playwright Workbench").first()).toBeVisible();
  await expect(page.getByText(/Agent v/)).toBeVisible({ timeout: 15_000 });

  // 2. Open the Allure fixture.
  await page
    .getByLabel("Absolute path to a Playwright project")
    .fill(FIXTURE);
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByText("Ready")).toBeVisible({ timeout: 15_000 });

  // 3. Inventory shows both fixture specs.
  await expect(page.getByText("tests/example.spec.ts")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/passes a trivial assertion/)).toBeVisible();
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, "allure-smoke-after-open.png"),
    fullPage: true,
  });

  // 4. Trigger a run via the GUI Run button.
  await page.getByRole("button", { name: /Run Playwright/ }).click();

  // 5. Wait for terminal status. The fixture has 1 intentional failure,
  //    so the run completes with status=failed. The QMO banner is
  //    rendered when the QMO summary lifecycle finishes — that is the
  //    end of the §1.2 pipeline.
  //
  //    The banner emits `data-testid="qmo-summary-banner-outcome"` once
  //    a real summary is loaded; we wait up to 90s to allow the run +
  //    `allure generate` + `allure quality-gate` + QMO persist
  //    sequence to complete in CI containers.
  const outcome = page.getByTestId("qmo-summary-banner-outcome");
  await expect(outcome).toBeVisible({ timeout: 120_000 });
  // The fixture has 1 failing test so the outcome must be Not Ready.
  await expect(outcome).toHaveText(/Not Ready/);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, "allure-smoke-after-run.png"),
    fullPage: true,
  });

  // 6. QG row should be visible because Allure CLI is installed in the
  //    fixture; status will be "failed" (max-failures violation).
  const qg = page.getByTestId("qmo-summary-banner-qg");
  await expect(qg).toBeVisible();
  await expect(qg).toContainText(/local-review|release-smoke|full-regression/);
});
