import { describe, expect, it } from "vitest";
import {
  buildPlaywrightTestCommand,
  PlaywrightCommandBuildError
} from "../src/playwright/builder";
import type { DetectedPackageManager } from "@pwqa/shared";

function pmTemplate(): DetectedPackageManager {
  return {
    name: "pnpm",
    status: "ok",
    confidence: "high",
    reason: "test",
    warnings: [],
    errors: [],
    lockfiles: ["pnpm-lock.yaml"],
    hasPlaywrightDevDependency: true,
    localBinaryUsable: true,
    blockingExecution: false,
    commandTemplates: {
      playwrightTest: { executable: "pnpm", args: ["exec", "playwright", "test"] }
    }
  };
}

describe("buildPlaywrightTestCommand", () => {
  it("appends list/json/html reporters and JSON output env", () => {
    const { command, env } = buildPlaywrightTestCommand({
      packageManager: pmTemplate(),
      request: { projectId: "/proj", headed: false },
      jsonOutputPath: "/proj/.playwright-workbench/runs/1/playwright-results.json",
      htmlOutputDir: "/proj/.playwright-workbench/runs/1/playwright-report",
      projectRoot: "/proj"
    });
    expect(command.args).toContain("--reporter=list,json,html");
    expect(env.PLAYWRIGHT_JSON_OUTPUT_NAME).toContain("playwright-results.json");
    expect(env.PLAYWRIGHT_HTML_REPORT).toContain("playwright-report");
  });

  it("collapses multiple testIds into a single --grep alternation", () => {
    const { command } = buildPlaywrightTestCommand({
      packageManager: pmTemplate(),
      request: {
        projectId: "/proj",
        testIds: ["abc-1", "def-2"],
        headed: false
      },
      jsonOutputPath: "/proj/.playwright-workbench/runs/1/playwright-results.json",
      htmlOutputDir: "/proj/.playwright-workbench/runs/1/playwright-report",
      projectRoot: "/proj"
    });
    const grepIndex = command.args.indexOf("--grep");
    expect(grepIndex).toBeGreaterThan(-1);
    const value = command.args[grepIndex + 1]!;
    expect(value).toMatch(/^\(.*\|.*\)$/);
    expect(value).toContain("abc-1");
    expect(value).toContain("def-2");
  });

  it("rejects specPath that escapes the project root", () => {
    expect(() =>
      buildPlaywrightTestCommand({
        packageManager: pmTemplate(),
        request: {
          projectId: "/proj",
          specPath: "../etc/passwd",
          headed: false
        },
        jsonOutputPath: "/proj/.playwright-workbench/runs/1/playwright-results.json",
        htmlOutputDir: "/proj/.playwright-workbench/runs/1/playwright-report",
        projectRoot: "/proj"
      })
    ).toThrow(PlaywrightCommandBuildError);
  });

  it("rejects specPath that begins with -", () => {
    expect(() =>
      buildPlaywrightTestCommand({
        packageManager: pmTemplate(),
        request: {
          projectId: "/proj",
          specPath: "-headed",
          headed: false
        },
        jsonOutputPath: "/proj/.playwright-workbench/runs/1/playwright-results.json",
        htmlOutputDir: "/proj/.playwright-workbench/runs/1/playwright-report",
        projectRoot: "/proj"
      })
    ).toThrow(PlaywrightCommandBuildError);
  });
});
