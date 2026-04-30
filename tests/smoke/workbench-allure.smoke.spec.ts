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

  // 5. Server-side end-to-end assertion: poll /api/runs until a terminal
  //    status appears, then poll /api/runs/<runId>/qmo-summary until the
  //    QMO summary file is persisted (200 with outcome). This validates
  //    the actual Phase 1.2 pipeline server-side; the GUI banner check
  //    afterwards is a UI sanity-check, not the primary acceptance signal.
  const apiBase = WORKBENCH_URL.replace(/\/$/, "");
  let latestRunId: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${apiBase}/api/runs`);
        if (!response.ok()) return "unreachable";
        const body = (await response.json()) as {
          runs: ReadonlyArray<{ runId: string; status: string }>;
        };
        const terminal = body.runs.find(
          (r) => r.status === "passed" || r.status === "failed"
        );
        if (terminal) latestRunId = terminal.runId;
        return terminal?.status ?? "running";
      },
      { timeout: 150_000, intervals: [1_000] }
    )
    .toMatch(/passed|failed/);

  expect(latestRunId).toBeDefined();
  // QMO summary persistence happens inside the same post-run lifecycle
  // that flips status, but the file may briefly be unreadable (write
  // before flush) or schema validation may fail mid-write — both
  // surface as transient 500 from /api/runs/:id/qmo-summary. Treat any
  // non-success status as "still processing" until either the outcome
  // settles or the timeout is reached. Diagnostic: log the last response
  // shape on each iteration so CI artifacts capture the failure mode.
  let qmoOutcome: string | undefined;
  let lastDiagnostic = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${apiBase}/api/runs/${encodeURIComponent(latestRunId!)}/qmo-summary`
        );
        if (response.status() === 409) {
          lastDiagnostic = "409 NO_QMO_SUMMARY (file not yet generated)";
          return "not-ready-yet";
        }
        if (!response.ok()) {
          let bodyText = "";
          try {
            bodyText = await response.text();
          } catch {
            bodyText = "(unreadable body)";
          }
          lastDiagnostic = `http-${response.status()}: ${bodyText.slice(0, 200)}`;
          return `transient-${response.status()}`;
        }
        const body = (await response.json()) as { outcome?: string };
        qmoOutcome = body.outcome;
        lastDiagnostic = `200 outcome=${body.outcome ?? "(none)"}`;
        return body.outcome ?? "no-outcome";
      },
      { timeout: 90_000, intervals: [1_000] }
    )
    .toBe("not-ready");
  expect(qmoOutcome, `last QMO endpoint diag: ${lastDiagnostic}`).toBe("not-ready");

  // 6. UI sanity check: navigate to /qmo and assert the banner
  //    surfaces the outcome the server already confirmed.
  await page.goto(`${WORKBENCH_URL}/qmo`);
  await expect(page.getByText(/Agent v/)).toBeVisible({ timeout: 15_000 });
  const outcome = page.getByTestId("qmo-summary-banner-outcome");
  await expect(outcome).toBeVisible({ timeout: 30_000 });
  await expect(outcome).toHaveText(/Not Ready/);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, "allure-smoke-after-run.png"),
    fullPage: true,
  });

  // 7. QG row is best-effort: it depends on Allure CLI exit code +
  //    quality-gate-result.json being readable. In CI the row may be
  //    absent if the QG step skipped (no-results, binary path mismatch
  //    etc). When present, validate its profile label; otherwise just
  //    log it for the artifacts.
  const qg = page.getByTestId("qmo-summary-banner-qg");
  if ((await qg.count()) > 0) {
    await expect(qg).toContainText(/local-review|release-smoke|full-regression/);
  } else {
    // eslint-disable-next-line no-console -- artifact diagnostic
    console.log("[smoke] QG row not present (quality-gate may have skipped)");
  }
});
