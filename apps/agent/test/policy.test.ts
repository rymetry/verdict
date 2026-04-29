import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CommandArgsValidationResult,
  createAllureCommandPolicy,
  createDefaultCommandPolicy,
  validateAllureArgs,
  validateAllureGenerateArgs,
  validatePhase1PlaywrightArgs
} from "../src/commands/policy.js";
import { CommandPolicyError, createNodeCommandRunner } from "../src/commands/runner.js";

function validate(
  executableName: string,
  args: ReadonlyArray<string>
): CommandArgsValidationResult {
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
    expect(validate(executableName, args).ok).toBe(true);
  });

  it("allows a grep value exactly at the argument length boundary", () => {
    expect(validate("pnpm", ["exec", "playwright", "test", "--grep", "x".repeat(4_096)]).ok).toBe(true);
  });

  it.each([
    ["npx", ["cowsay"]],
    ["pnpm", ["exec", "arbitrary", "test"]],
    ["git", ["push"]],
    ["node", ["-e", "console.log(1)"]],
    ["pnpm", ["exec", "playwright", "test", "--config", "/tmp/x"]],
    ["pnpm", ["exec", "playwright", "test", "/tmp/example.spec.ts"]],
    ["pnpm", ["exec", "playwright", "test", "%2fetc%2fpasswd"]],
    ["pnpm", ["exec", "playwright", "test", "%252fetc%252fpasswd"]],
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
    expect(validate(executableName, args).ok).toBe(false);
  });

  it.each([
    [["exec", "playwright", "test", "%zz/outside.spec.ts"], "invalid-uri-encoding"],
    [["exec", "playwright", "test", "%25252e%25252e/outside.spec.ts"], "path-traversal"],
    [["exec", "playwright", "test", "%2fetc%2fpasswd"], "absolute-path"],
    [["exec", "playwright", "test", "--grep", "--headed"], "missing-flag-value"],
    [["exec", "playwright", "test", "--config", "/tmp/x"], "disallowed-flag"]
  ])("returns stable validator code %#", (args, code) => {
    const result = validate("pnpm", args);
    expect(result).toEqual(expect.objectContaining({ ok: false, code }));
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

/* ----------------------------------------------------------------- */
/* T204-2: Allure generate command policy                            */
/* ----------------------------------------------------------------- */

function validateAllure(
  executableName: string,
  args: ReadonlyArray<string>
): CommandArgsValidationResult {
  return validateAllureGenerateArgs({ executableName, args });
}

describe("Allure generate command policy (T204-2)", () => {
  it("accepts the canonical generate invocation", () => {
    const result = validateAllure("allure", [
      "generate",
      ".playwright-workbench/runs/r1/allure-results",
      "-o",
      ".playwright-workbench/runs/r1/allure-report",
      "--clean"
    ]);
    expect(result.ok).toBe(true);
  });

  it("accepts --output as a long-form synonym", () => {
    const result = validateAllure("allure", [
      "generate",
      "results",
      "--output",
      "report"
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects when subcommand is missing", () => {
    const result = validateAllure("allure", []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing-subcommand");
    }
  });

  it("rejects subcommands other than 'generate' (defense-in-depth)", () => {
    const result = validateAllure("allure", ["open", "results"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("disallowed-subcommand");
    }
  });

  it("rejects unsupported executables", () => {
    const result = validateAllure("npx", ["generate", "results", "-o", "report"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported-executable");
    }
  });

  it("requires the explicit output flag", () => {
    const result = validateAllure("allure", ["generate", "results"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing-output-flag");
    }
  });

  it("requires exactly one positional results-dir", () => {
    const noPositional = validateAllure("allure", ["generate", "-o", "report"]);
    expect(noPositional.ok).toBe(false);
    if (!noPositional.ok) {
      expect(noPositional.code).toBe("missing-results-dir");
    }
    const twoPositionals = validateAllure("allure", ["generate", "a", "b", "-o", "report"]);
    expect(twoPositionals.ok).toBe(false);
    if (!twoPositionals.ok) {
      expect(twoPositionals.code).toBe("extra-positional");
    }
  });

  it("rejects absolute paths in results-dir or output-dir", () => {
    const absoluteResults = validateAllure("allure", [
      "generate",
      "/tmp/results",
      "-o",
      "report"
    ]);
    expect(absoluteResults.ok).toBe(false);
    const absoluteOutput = validateAllure("allure", [
      "generate",
      "results",
      "-o",
      "/tmp/report"
    ]);
    expect(absoluteOutput.ok).toBe(false);
  });

  it("rejects '..' traversal in either path", () => {
    const result = validateAllure("allure", [
      "generate",
      "results/../escape",
      "-o",
      "report"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("path-traversal");
    }
  });

  it("rejects unknown flags", () => {
    const result = validateAllure("allure", [
      "generate",
      "results",
      "-o",
      "report",
      "--port",
      "8080"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("disallowed-flag");
    }
  });

  it("rejects duplicate output flag (same form: -o ... -o ...)", () => {
    const result = validateAllure("allure", [
      "generate",
      "results",
      "-o",
      "report1",
      "-o",
      "report2"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("duplicate-output-flag");
    }
  });

  it("rejects mixed-synonym output flags (-o then --output)", () => {
    // `-o` and `--output` are synonyms; supplying both should fail just
    // like supplying `-o` twice. Defense-in-depth against argv-builder
    // refactors that might split the synonyms accidentally.
    const result = validateAllure("allure", [
      "generate",
      "results",
      "-o",
      "report1",
      "--output",
      "report2"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("duplicate-output-flag");
    }
  });

  it("rejects mixed-synonym output flags (--output then -o)", () => {
    const result = validateAllure("allure", [
      "generate",
      "results",
      "--output",
      "report1",
      "-o",
      "report2"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("duplicate-output-flag");
    }
  });

  it("rejects duplicate --config (other value flag)", () => {
    const result = validateAllure("allure", [
      "generate",
      "results",
      "-o",
      "report",
      "--config",
      "a.mjs",
      "--config",
      "b.mjs"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("duplicate-flag");
    }
  });

  it("rejects duplicate --report-name (other value flag)", () => {
    const result = validateAllure("allure", [
      "generate",
      "results",
      "-o",
      "report",
      "--report-name",
      "first",
      "--report-name",
      "second"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("duplicate-flag");
    }
  });

  it("rejects NUL bytes in any argument", () => {
    const result = validateAllure("allure", [
      "generate",
      "results nul",
      "-o",
      "report"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("nul-byte");
    }
  });

  it("accepts --config with a project-relative path", () => {
    const result = validateAllure("allure", [
      "generate",
      "results",
      "-o",
      "report",
      "--config",
      ".playwright-workbench/config/allurerc.mjs"
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects --config with absolute path", () => {
    const result = validateAllure("allure", [
      "generate",
      "results",
      "-o",
      "report",
      "--config",
      "/etc/allurerc.mjs"
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("createAllureCommandPolicy", () => {
  it("returns a policy that only allows the `allure` executable", async () => {
    const fs = await import("node:fs");
    const cwdBoundary = os.tmpdir();
    const policy = createAllureCommandPolicy(cwdBoundary);
    expect(policy.allowedExecutables).toEqual(["allure"]);
    // The policy resolves the boundary via fs.realpathSync, which on
    // macOS may translate `/var/folders/...` to `/private/var/folders/...`.
    expect(policy.cwdBoundary).toBe(fs.realpathSync(cwdBoundary));
  });

  it("policy rejects an attempt to spawn a non-allure executable", () => {
    const cwdBoundary = os.tmpdir();
    const policy = createAllureCommandPolicy(cwdBoundary);
    const result = policy.argValidator({
      executableName: "node",
      args: ["generate", "results", "-o", "report"]
    });
    expect(result.ok).toBe(false);
  });

  it("policy with default validator accepts the canonical generate invocation", () => {
    const cwdBoundary = os.tmpdir();
    const policy = createAllureCommandPolicy(cwdBoundary);
    const result = policy.argValidator({
      executableName: "allure",
      args: ["generate", "results", "-o", "report", "--clean"]
    });
    expect(result.ok).toBe(true);
  });
});

/* ---------------------------------------------------------------- */
/* T205-1: Allure quality-gate command policy                       */
/* ---------------------------------------------------------------- */

function validateAllureQg(
  executableName: string,
  args: ReadonlyArray<string>
): CommandArgsValidationResult {
  return validateAllureArgs({ executableName, args });
}

describe("Allure quality-gate command policy (T205-1)", () => {
  it("accepts the canonical quality-gate invocation with all numeric thresholds", () => {
    const result = validateAllureQg("allure", [
      "quality-gate",
      ".playwright-workbench/runs/r1/allure-results",
      "--max-failures",
      "0",
      "--success-rate",
      "100",
      "--min-tests-count",
      "1"
    ]);
    expect(result.ok).toBe(true);
  });

  it("accepts the bare quality-gate invocation (CLI defaults)", () => {
    const result = validateAllureQg("allure", [
      "quality-gate",
      "results"
    ]);
    expect(result.ok).toBe(true);
  });

  it("accepts --fast-fail standalone flag", () => {
    const result = validateAllureQg("allure", [
      "quality-gate",
      "results",
      "--fast-fail",
      "--max-failures",
      "0"
    ]);
    expect(result.ok).toBe(true);
  });

  it("accepts --known-issues with a project-relative path", () => {
    const result = validateAllureQg("allure", [
      "quality-gate",
      "results",
      "--known-issues",
      ".playwright-workbench/reports/known-issues.json"
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects --known-issues with absolute path (path validation reuse)", () => {
    const result = validateAllureQg("allure", [
      "quality-gate",
      "results",
      "--known-issues",
      "/etc/known-issues.json"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("absolute-path");
    }
  });

  it("rejects generate-only flags on quality-gate (-o is generate-specific)", () => {
    // The validator dispatches per subcommand: -o is in the generate
    // value-flag set but not the quality-gate set, so it lands in the
    // disallowed-flag bucket here.
    const result = validateAllureQg("allure", [
      "quality-gate",
      "results",
      "-o",
      "report"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("disallowed-flag");
    }
  });

  it("rejects quality-gate-only flags on generate (--fast-fail is qg-specific)", () => {
    // Mirror image: --fast-fail is only valid for quality-gate.
    const result = validateAllureQg("allure", [
      "generate",
      "results",
      "-o",
      "report",
      "--fast-fail"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("disallowed-flag");
    }
  });

  it("requires the positional results-dir for quality-gate", () => {
    const result = validateAllureQg("allure", [
      "quality-gate",
      "--max-failures",
      "0"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing-results-dir");
    }
  });

  it("rejects duplicate quality-gate flags (defense-in-depth)", () => {
    const result = validateAllureQg("allure", [
      "quality-gate",
      "results",
      "--max-failures",
      "0",
      "--max-failures",
      "5"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("duplicate-flag");
    }
  });

  it("does NOT enforce missing-output-flag on quality-gate (it has no output dir)", () => {
    // generate requires `-o`; quality-gate must not. This guards against
    // a future refactor accidentally bundling the generate-specific
    // post-loop check into the shared validator.
    const result = validateAllureQg("allure", ["quality-gate", "results"]);
    expect(result.ok).toBe(true);
  });
});

describe("validateAllureGenerateArgs backward-compat alias", () => {
  it("re-exports validateAllureArgs so existing T204 callers keep working", () => {
    expect(validateAllureGenerateArgs).toBe(validateAllureArgs);
  });
});
