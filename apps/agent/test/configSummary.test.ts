import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildConfigSummary } from "../src/project/configSummary.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-config-summary-")));
});

afterEach(() => {
  if (workdir) fs.rmSync(workdir, { recursive: true, force: true });
});

describe("buildConfigSummary", () => {
  it("extracts reporters and use options without executing playwright config", async () => {
    const configPath = path.join(workdir, "playwright.config.ts");
    fs.writeFileSync(
      configPath,
      [
        "export default {",
        "  reporter: [['list'], ['html'], ['allure-playwright']],",
        "  use: { trace: 'on-first-retry', screenshot: 'only-on-failure', video: 'retain-on-failure' }",
        "};"
      ].join("\n")
    );

    const summary = await buildConfigSummary({
      projectId: "p1",
      projectRoot: workdir,
      configPath
    });

    expect(summary.config.relativePath).toBe("playwright.config.ts");
    expect(summary.config.format).toBe("ts");
    expect(summary.reporters.map((reporter) => reporter.name)).toEqual([
      "list",
      "html",
      "allure-playwright"
    ]);
    expect(summary.useOptions).toEqual([
      { name: "trace", value: "on-first-retry", source: "heuristic" },
      { name: "screenshot", value: "only-on-failure", source: "heuristic" },
      { name: "video", value: "retain-on-failure", source: "heuristic" }
    ]);
  });

  it("lists fixture-like files using project-relative paths and signals", async () => {
    fs.mkdirSync(path.join(workdir, "tests", "fixtures"), { recursive: true });
    fs.mkdirSync(path.join(workdir, "tests", "helpers"), { recursive: true });
    fs.writeFileSync(path.join(workdir, "tests", "fixtures", "auth.fixture.ts"), "export const user = {};\n");
    fs.writeFileSync(
      path.join(workdir, "tests", "helpers", "base.ts"),
      "import { test as base } from '@playwright/test';\nexport const test = base.extend({});\n"
    );

    const summary = await buildConfigSummary({
      projectId: "p1",
      projectRoot: workdir
    });

    expect(summary.fixtureFiles).toEqual([
      expect.objectContaining({
        relativePath: "tests/fixtures/auth.fixture.ts",
        kind: "fixture-file",
        signals: ["fixture-path"]
      }),
      expect.objectContaining({
        relativePath: "tests/helpers/base.ts",
        kind: "test-extend",
        signals: ["test-extend"]
      })
    ]);
    expect(summary.warnings).toContain("playwright.config.{ts,js,mjs,cjs} was not found.");
  });

  it("surfaces storageState and auth setup risks without reading state contents", async () => {
    const configPath = path.join(workdir, "playwright.config.ts");
    fs.writeFileSync(
      configPath,
      [
        "export default {",
        "  globalSetup: './tests/auth/global.setup.ts',",
        "  use: { storageState: 'playwright/.auth/user.json' },",
        "};"
      ].join("\n")
    );
    fs.mkdirSync(path.join(workdir, "tests", "auth"), { recursive: true });
    fs.writeFileSync(
      path.join(workdir, "tests", "auth", "global.setup.ts"),
      "import { test } from '@playwright/test';\nexport async function setup() { await test.step('login', async () => {}); }\n"
    );

    const summary = await buildConfigSummary({
      projectId: "p1",
      projectRoot: workdir,
      configPath
    });

    expect(summary.authRisks).toEqual([
      expect.objectContaining({
        signal: "storage-state-path",
        severity: "warning",
        relativePath: "playwright/.auth/user.json"
      }),
      expect.objectContaining({
        signal: "global-setup",
        severity: "info",
        relativePath: "./tests/auth/global.setup.ts"
      }),
      expect.objectContaining({
        signal: "auth-setup-file",
        severity: "info",
        relativePath: "tests/auth/global.setup.ts"
      })
    ]);
  });

  it("does not return unsafe storageState paths", async () => {
    const configPath = path.join(workdir, "playwright.config.ts");
    fs.writeFileSync(
      configPath,
      [
        "export default {",
        "  use: { storageState: '/Users/example/.auth/state.json' },",
        "  projects: [{ use: { storageState: { cookies: [], origins: [] } } }]",
        "};"
      ].join("\n")
    );

    const summary = await buildConfigSummary({
      projectId: "p1",
      projectRoot: workdir,
      configPath
    });

    expect(summary.authRisks).toEqual([
      expect.objectContaining({
        signal: "storage-state-path",
        severity: "high",
        relativePath: undefined
      }),
      expect.objectContaining({
        signal: "storage-state-inline",
        severity: "high",
        relativePath: "playwright.config.ts"
      })
    ]);
    expect(JSON.stringify(summary.authRisks)).not.toContain("/Users/example");
  });
});
