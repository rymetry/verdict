import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDefaultCommandPolicy,
  validatePhase1PlaywrightArgs
} from "../src/commands/policy.js";
import { CommandPolicyError, createNodeCommandRunner } from "../src/commands/runner.js";

function validate(executableName: string, args: ReadonlyArray<string>): string | null {
  return validatePhase1PlaywrightArgs({ executableName, args });
}

describe("default Phase 1 command policy", () => {
  it.each([
    ["pnpm", ["exec", "playwright", "test", "--list", "--reporter=json"]],
    [
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "--reporter=list,json,html",
        "--grep",
        "trivial passing assertion"
      ]
    ],
    [
      "pnpm",
      ["exec", "playwright", "test", "--reporter=list,json,html", "--grep", "ログインできること"]
    ],
    [
      "pnpm",
      ["exec", "playwright", "test", "--project", "chromium", "tests/example.spec.ts"]
    ],
    ["npx", ["--no-install", "playwright", "test", "--reporter=list,json,html"]],
    ["yarn", ["playwright", "test", "--list", "--reporter=json"]]
  ])("allows approved %s Playwright command shapes", (executableName, args) => {
    expect(validate(executableName, args)).toBeNull();
  });

  it("allows a grep value exactly at the argument length boundary", () => {
    expect(validate("pnpm", ["exec", "playwright", "test", "--grep", "x".repeat(4_096)])).toBeNull();
  });

  it.each([
    ["npx", ["cowsay"]],
    ["pnpm", ["exec", "arbitrary", "test"]],
    ["git", ["push"]],
    ["node", ["-e", "console.log(1)"]],
    ["pnpm", ["exec", "playwright", "test", "--config", "/tmp/x"]],
    ["pnpm", ["exec", "playwright", "test", "/tmp/example.spec.ts"]],
    ["pnpm", ["exec", "playwright", "test", "../outside.spec.ts"]],
    ["pnpm", ["exec", "playwright", "test", "%2e%2e/outside.spec.ts"]],
    ["pnpm", ["exec", "playwright", "test", "%252e%252e/outside.spec.ts"]],
    ["pnpm", ["exec", "playwright", "test", "%25252e%25252e/outside.spec.ts"]],
    ["pnpm", ["exec", "playwright", "test", "%zz/outside.spec.ts"]],
    ["pnpm", ["exec", "playwright", "test", "tests/example.spec.ts\0"]],
    ["pnpm", ["exec", "playwright", "test", "--grep", "x".repeat(4_097)]],
    ["pnpm", ["exec", "playwright", "test", "--reporter=list,json,html,allure-playwright"]],
    ["pnpm", ["exec", "playwright", "test", "--grep", "--headed"]]
  ])("rejects unsafe command shape for %s", (executableName, args) => {
    expect(validate(executableName, args)).toEqual(expect.any(String));
  });

  it("wires the validator into the default runner policy", () => {
    const cwdBoundary = path.resolve(os.tmpdir());
    const runner = createNodeCommandRunner({
      policy: createDefaultCommandPolicy(cwdBoundary)
    });
    expect(() =>
      runner.run({
        executable: "git",
        args: ["push"],
        cwd: cwdBoundary
      })
    ).toThrow(CommandPolicyError);
  });
});
