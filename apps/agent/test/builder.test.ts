import { describe, expect, it } from "vitest";
import {
  buildPlaywrightLaunchCommand,
  buildPlaywrightTestCommand,
  PlaywrightCommandBuildError
} from "../src/playwright/builder";
import { validatePhase1PlaywrightArgs, validatePlaywrightLaunchArgs } from "../src/commands/policy";
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

  it("preserves playwright.config reporters in project-config mode", () => {
    const { command, env } = buildPlaywrightTestCommand({
      packageManager: pmTemplate(),
      request: { projectId: "/proj", headed: false },
      reporterMode: "project-config",
      jsonOutputPath: "/proj/.playwright-workbench/runs/1/playwright-results.json",
      htmlOutputDir: "/proj/.playwright-workbench/runs/1/playwright-report",
      projectRoot: "/proj"
    });
    expect(command.args).not.toContain("--reporter=list,json,html");
    expect(env.PLAYWRIGHT_JSON_OUTPUT_NAME).toContain("playwright-results.json");
    expect(env.PLAYWRIGHT_HTML_REPORT).toContain("playwright-report");
    expect(env.PLAYWRIGHT_HTML_OPEN).toBe("never");
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

  it("emits argv accepted by the default Phase 1 command policy", () => {
    const { command } = buildPlaywrightTestCommand({
      packageManager: pmTemplate(),
      request: {
        projectId: "/proj",
        headed: true,
        projectNames: ["chromium"],
        grep: "ログインできること",
        testIds: ["trivial passing assertion"],
        specPath: "tests/example.spec.ts",
        retries: 2,
        workers: 4
      },
      jsonOutputPath: "/proj/.playwright-workbench/runs/1/playwright-results.json",
      htmlOutputDir: "/proj/.playwright-workbench/runs/1/playwright-report",
      projectRoot: "/proj"
    });

    expect(
      validatePhase1PlaywrightArgs({
        executableName: command.executable,
        args: command.args
      })
    ).toEqual({ ok: true });
    expect(command.args).toContain("--retries");
    expect(command.args).toContain("2");
    expect(command.args).toContain("--workers");
    expect(command.args).toContain("4");
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

describe("buildPlaywrightLaunchCommand", () => {
  it("builds a UI Mode command from the local Playwright prefix", () => {
    const response = buildPlaywrightLaunchCommand({
      packageManager: pmTemplate(),
      projectId: "/proj",
      request: { kind: "ui-mode" }
    });

    expect(response.command).toEqual({
      executable: "pnpm",
      args: ["exec", "playwright", "test", "--ui"]
    });
    expect(
      validatePlaywrightLaunchArgs({
        executableName: response.command.executable,
        args: response.command.args
      })
    ).toEqual({ ok: true });
  });

  it("builds Codegen with an optional http URL", () => {
    const response = buildPlaywrightLaunchCommand({
      packageManager: pmTemplate(),
      projectId: "/proj",
      request: { kind: "codegen", codegenUrl: "https://example.com/login" }
    });

    expect(response.command.args).toEqual([
      "exec",
      "playwright",
      "codegen",
      "https://example.com/login"
    ]);
  });

  it("builds Trace Viewer only for a project-relative trace zip", () => {
    const response = buildPlaywrightLaunchCommand({
      packageManager: pmTemplate(),
      projectId: "/proj",
      request: { kind: "trace-viewer", tracePath: "test-results/trace.zip" }
    });

    expect(response.command.args).toEqual([
      "exec",
      "playwright",
      "show-trace",
      "test-results/trace.zip"
    ]);
  });

  it("rejects command templates that do not invoke playwright", () => {
    expect(() =>
      buildPlaywrightLaunchCommand({
        packageManager: {
          ...pmTemplate(),
          commandTemplates: {
            playwrightTest: { executable: "pnpm", args: ["exec", "node", "test"] }
          }
        },
        projectId: "/proj",
        request: { kind: "ui-mode" }
      })
    ).toThrow(PlaywrightCommandBuildError);
  });
});
