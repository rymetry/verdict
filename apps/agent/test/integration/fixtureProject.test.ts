/**
 * Integration smoke test (PLAN.v2 §32 Phase 1 acceptance):
 *
 * Drives the Workbench Agent against a *real* Playwright fixture project
 * (`tests/fixtures/sample-pw-project/`) so we exercise:
 *
 *   - ProjectScanner against a real `package.json` + `pnpm-lock.yaml`
 *   - PackageManagerDetector resolving pnpm
 *   - real `pnpm exec playwright test --list --reporter=json` invocation
 *   - parsePlaywrightListJson on actual Playwright stdout
 *
 * It does NOT execute the run pipeline (browsers are not installed in CI);
 * Phase 1.2 will add a browser-launching e2e once Allure lands.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { scanProject } from "../../src/project/scanner";
import { buildInventory } from "../../src/project/inventory";
import { createNodeCommandRunner } from "../../src/commands/runner";
import { DEFAULT_ALLOWED_EXECUTABLES, DEFAULT_ENV_ALLOWLIST } from "../../src/commands/policy";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(here, "../../../../tests/fixtures/sample-pw-project");

describe("integration: sample-pw-project fixture", () => {
  it("fixture exists in the workspace", () => {
    expect(fs.existsSync(path.join(fixtureRoot, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(fixtureRoot, "playwright.config.ts"))).toBe(true);
  });

  it("scanProject detects pnpm + non-blocking execution", async () => {
    const { summary, packageManager } = await scanProject({
      rootPath: fixtureRoot,
      allowedRoots: [fixtureRoot]
    });
    expect(packageManager.name).toBe("pnpm");
    expect(packageManager.hasPlaywrightDevDependency).toBe(true);
    expect(packageManager.localBinaryUsable).toBe(true);
    expect(summary.blockingExecution).toBe(false);
    expect(summary.playwrightConfigPath).toMatch(/playwright\.config\.ts$/);
  });

  it("buildInventory returns the fixture's specs via real Playwright --list --reporter=json", async () => {
    const { summary, packageManager } = await scanProject({
      rootPath: fixtureRoot,
      allowedRoots: [fixtureRoot]
    });
    const runner = createNodeCommandRunner({
      policy: {
        allowedExecutables: DEFAULT_ALLOWED_EXECUTABLES,
        cwdBoundary: fixtureRoot,
        envAllowlist: DEFAULT_ENV_ALLOWLIST
      }
    });
    const inventory = await buildInventory({
      projectId: summary.id,
      projectRoot: summary.rootPath,
      packageManager,
      runner,
      timeoutMs: 60_000
    });
    expect(inventory.source).toBe("playwright-list-json");
    expect(inventory.error).toBeUndefined();
    expect(inventory.totals.specFiles).toBeGreaterThan(0);
    expect(inventory.totals.tests).toBeGreaterThanOrEqual(2);

    const titles = inventory.specs.flatMap((spec) => spec.tests.map((test) => test.title));
    expect(titles).toContain("trivial passing assertion");
    expect(titles.some((title) => title.includes("@smoke"))).toBe(true);
  }, 90_000);
});
