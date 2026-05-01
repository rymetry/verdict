import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type CommandArgsValidationResult,
  createAiCommandPolicy,
  createAllureCommandPolicy,
  createDefaultCommandPolicy,
  createGitPatchCommandPolicy,
  validateAiArgs,
  validateAllureArgs,
  validateAllureGenerateArgs,
  validateGitPatchArgs,
  validatePhase1PlaywrightArgs,
  validatePlaywrightLaunchArgs
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
    [
      "pnpm",
      ["exec", "playwright", "test", "--retries", "2", "--workers", "4"]
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
    ["pnpm", ["exec", "playwright", "test", "--grep", "--headed"]],
    ["pnpm", ["exec", "playwright", "test", "--retries", "--headed"]],
    ["pnpm", ["exec", "playwright", "test", "--retries", "1.5"]],
    ["pnpm", ["exec", "playwright", "test", "--workers", "0"]],
    ["pnpm", ["exec", "playwright", "test", "--workers", "00"]]
  ])("rejects unsafe command shape for %s", (executableName, args) => {
    expect(validate(executableName, args).ok).toBe(false);
  });

  it.each([
    [["exec", "playwright", "test", "%zz/outside.spec.ts"], "invalid-uri-encoding"],
    [["exec", "playwright", "test", "%25252e%25252e/outside.spec.ts"], "path-traversal"],
    [["exec", "playwright", "test", "%2fetc%2fpasswd"], "absolute-path"],
    [["exec", "playwright", "test", "--grep", "--headed"], "missing-flag-value"],
    [["exec", "playwright", "test", "--workers", "00"], "invalid-numeric-value"],
    [["exec", "playwright", "test", "--config", "/tmp/x"], "absolute-path"]
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

describe("Playwright launch command policy (T800-3)", () => {
  it.each([
    ["pnpm", ["exec", "playwright", "test", "--ui"]],
    ["pnpm", ["exec", "playwright", "codegen"]],
    ["pnpm", ["exec", "playwright", "codegen", "https://example.com/login"]],
    ["pnpm", ["exec", "playwright", "show-trace", "test-results/trace.zip"]],
    ["npx", ["--no-install", "playwright", "test", "--ui"]],
    ["yarn", ["playwright", "show-trace", ".playwright-workbench/runs/r1/trace.zip"]]
  ])("allows approved %s launch command shapes", (executableName, args) => {
    expect(validatePlaywrightLaunchArgs({ executableName, args }).ok).toBe(true);
  });

  it.each([
    ["pnpm", ["exec", "playwright", "test"]],
    ["pnpm", ["exec", "playwright", "test", "--headed"]],
    ["pnpm", ["exec", "playwright", "codegen", "file:///tmp/index.html"]],
    ["pnpm", ["exec", "playwright", "codegen", "--target=python"]],
    ["pnpm", ["exec", "playwright", "show-trace", "/tmp/trace.zip"]],
    ["pnpm", ["exec", "playwright", "show-trace", "../trace.zip"]],
    ["pnpm", ["exec", "playwright", "show-trace", "trace.json"]],
    ["pnpm", ["exec", "playwright", "open", "https://example.com"]],
    ["node", ["exec", "playwright", "test", "--ui"]]
  ])("rejects unsafe launch command shape for %s", (executableName, args) => {
    expect(validatePlaywrightLaunchArgs({ executableName, args }).ok).toBe(false);
  });
});

describe("AI CLI command policy (T500-2)", () => {
  const approvedArgs = ["--print", "--output-format", "json"];

  it("accepts the approved Claude Code non-interactive JSON invocation", () => {
    expect(validateAiArgs({ executableName: "claude", args: approvedArgs }).ok).toBe(true);
  });

  it.each([
    ["codex", approvedArgs],
    ["claude", ["--print", "--output-format", "text"]],
    ["claude", ["--bare", "--print", "--output-format", "json"]]
  ])("rejects unsafe AI invocation for %s", (executableName, args) => {
    expect(validateAiArgs({ executableName, args }).ok).toBe(false);
  });

  it("rejects Claude capability checks; Workbench classifies real invocation stderr instead", () => {
    expect(validateAiArgs({ executableName: "claude", args: ["--help"] }).ok).toBe(false);
  });

  it("returns a policy that only allows Claude Code", async () => {
    const fs = await import("node:fs");
    const policy = createAiCommandPolicy(os.tmpdir());
    expect(policy.allowedExecutables).toEqual(["claude"]);
    expect(policy.cwdBoundary).toBe(fs.realpathSync(os.tmpdir()));
  });
});

describe("Git patch command policy (T600-1)", () => {
  it.each([
    [["apply", "--check", "-"]],
    [["apply", "-"]],
    [["apply", "--reverse", "-"]],
    [["status", "--porcelain", "--", "src/example.ts"]],
    [["status", "--porcelain", "--", "src/example.ts", "tests/example.spec.ts"]]
  ])("allows approved git invocation %#", (args) => {
    expect(validateGitPatchArgs({ executableName: "git", args }).ok).toBe(true);
  });

  it.each([
    ["node", ["apply", "-"], "unsupported-executable"],
    ["git", ["apply", "--index", "-"], "invalid-prefix"],
    ["git", ["status", "--porcelain", "--"], "disallowed-operand"],
    ["git", ["status", "--porcelain", "--", "/tmp/file.ts"], "absolute-path"],
    ["git", ["status", "--porcelain", "--", "../outside.ts"], "path-traversal"],
    ["git", ["status", "--porcelain", "--", "-n"], "flag-like-operand"]
  ])("rejects unsafe git invocation for %s", (executableName, args, code) => {
    const result = validateGitPatchArgs({ executableName, args });
    expect(result).toEqual(expect.objectContaining({ ok: false, code }));
  });

  it("returns a policy that only allows git", async () => {
    const fs = await import("node:fs");
    const policy = createGitPatchCommandPolicy(os.tmpdir());
    expect(policy.allowedExecutables).toEqual(["git"]);
    expect(policy.cwdBoundary).toBe(fs.realpathSync(os.tmpdir()));
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
      ".playwright-workbench/runs/r1/allure-report"
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
      args: ["generate", "results", "-o", "report"]
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

/* ---------------------------------------------------------------- */
/* T206/T207: Allure supplemental artifacts                         */
/* ---------------------------------------------------------------- */

function validateAllureGen(
  executableName: string,
  args: ReadonlyArray<string>
): CommandArgsValidationResult {
  return validateAllureArgs({ executableName, args });
}

describe("Allure supplemental command policy (T206/T207)", () => {
  it("rejects removed generate-only --clean flag for Allure 3.6 compatibility", () => {
    const result = validateAllureGen("allure", [
      "generate",
      "results",
      "-o",
      "report",
      "--clean"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("disallowed-flag");
    }
  });

  it("accepts history --history-path with a project-relative path", () => {
    const result = validateAllureGen("allure", [
      "history",
      "--history-path",
      ".playwright-workbench/reports/allure-history.jsonl",
      "results"
    ]);
    expect(result.ok).toBe(true);
  });

  it("accepts the history short -h synonym", () => {
    const result = validateAllureGen("allure", [
      "history",
      "-h",
      ".playwright-workbench/reports/allure-history.jsonl",
      "results"
    ]);
    expect(result.ok).toBe(true);
  });

  it("requires history path for history command", () => {
    const result = validateAllureGen("allure", [
      "history",
      "results"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing-history-path-flag");
    }
  });

  it("rejects history --history-path with absolute path", () => {
    const result = validateAllureGen("allure", [
      "history",
      "--history-path",
      "/etc/history.jsonl",
      "results",
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("absolute-path");
    }
  });

  it("rejects duplicate history --history-path (same form)", () => {
    const result = validateAllureGen("allure", [
      "history",
      "--history-path",
      "a.jsonl",
      "--history-path",
      "b.jsonl",
      "results"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("duplicate-flag");
    }
  });

  it("rejects mixed-form history -h / --history-path duplicates (synonym collision)", () => {
    // `canonicalAllureFlag` collapses `-h` to `--history-path` for the
    // duplicate-detection set so mixed-form usage is caught.
    const result = validateAllureGen("allure", [
      "history",
      "-h",
      "a.jsonl",
      "--history-path",
      "b.jsonl",
      "results"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("duplicate-flag");
    }
  });

  it("requires a value for --history-path", () => {
    const result = validateAllureGen("allure", [
      "history",
      "--history-path"
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing-flag-value");
    }
  });

  it("accepts csv with explicit output", () => {
    const result = validateAllureGen("allure", [
      "csv",
      "results",
      "-o",
      ".playwright-workbench/runs/r1/allure-exports/results.csv"
    ]);
    expect(result.ok).toBe(true);
  });

  it("requires csv output", () => {
    const result = validateAllureGen("allure", ["csv", "results"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("missing-output-flag");
    }
  });

  it("accepts log with optional display flags and no output flag", () => {
    const result = validateAllureGen("allure", [
      "log",
      "results",
      "--group-by",
      "suite",
      "--all-steps",
      "--with-trace"
    ]);
    expect(result.ok).toBe(true);
  });

  it("accepts known-issue with explicit output", () => {
    const result = validateAllureGen("allure", [
      "known-issue",
      "results",
      "-o",
      ".playwright-workbench/reports/known-issues.json"
    ]);
    expect(result.ok).toBe(true);
  });
});
