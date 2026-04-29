import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildQualityGateArgs,
  evaluateAllureQualityGate,
  persistQualityGateResult
} from "../src/playwright/allureQualityGate.js";
import type {
  CommandHandle,
  CommandRunner,
  CommandSpec
} from "../src/commands/runner.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-allure-qg-")));
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

interface FakeRun {
  spec: CommandSpec;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut?: boolean;
  rejection?: Error;
}

function fakeRunner(plan: Omit<FakeRun, "spec">): {
  runner: CommandRunner;
  spawned: FakeRun[];
} {
  const spawned: FakeRun[] = [];
  const runner: CommandRunner = {
    run(spec: CommandSpec): CommandHandle {
      const captured: FakeRun = { ...plan, spec };
      spawned.push(captured);
      const startedAt = new Date();
      const endedAt = new Date(startedAt.getTime() + plan.durationMs);
      const result = plan.rejection
        ? Promise.reject(plan.rejection)
        : Promise.resolve({
            exitCode: plan.exitCode,
            signal: plan.signal,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            durationMs: plan.durationMs,
            stdout: plan.stdout,
            stderr: plan.stderr,
            cancelled: false,
            timedOut: plan.timedOut ?? false,
            command: { executable: spec.executable, args: spec.args, cwd: spec.cwd }
          });
      return { result, cancel() {} };
    }
  };
  return { runner, spawned };
}

function setupAllureBinary(): { allureResultsDest: string } {
  const binDir = path.join(workdir, "node_modules", ".bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "allure"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(binDir, "allure"), 0o755);
  const runDir = path.join(workdir, ".playwright-workbench", "runs", "r1");
  const allureResultsDest = path.join(runDir, "allure-results");
  fs.mkdirSync(allureResultsDest, { recursive: true });
  return { allureResultsDest };
}

describe("buildQualityGateArgs", () => {
  it("emits the bare invocation when rules and known-issues are absent", () => {
    expect(buildQualityGateArgs("results")).toEqual(["quality-gate", "results"]);
  });

  it("appends numeric thresholds in stable order", () => {
    expect(
      buildQualityGateArgs("results", {
        maxFailures: 0,
        successRate: 100,
        minTestsCount: 1,
        fastFail: true
      })
    ).toEqual([
      "quality-gate",
      "results",
      "--max-failures",
      "0",
      "--min-tests-count",
      "1",
      "--success-rate",
      "100",
      "--fast-fail"
    ]);
  });

  it("omits flags whose value is undefined / falsy (fastFail)", () => {
    expect(
      buildQualityGateArgs("results", {
        maxFailures: 0,
        fastFail: false
      })
    ).toEqual(["quality-gate", "results", "--max-failures", "0"]);
  });

  it("appends --known-issues when provided", () => {
    expect(
      buildQualityGateArgs("results", undefined, ".playwright-workbench/known.json")
    ).toEqual([
      "quality-gate",
      "results",
      "--known-issues",
      ".playwright-workbench/known.json"
    ]);
  });
});

describe("evaluateAllureQualityGate", () => {
  it("returns status='skipped' with binary-missing failure mode when CLI absent", async () => {
    const allureResultsDest = path.join(workdir, ".playwright-workbench/runs/r1/allure-results");
    const { runner, spawned } = fakeRunner({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 0
    });

    const outcome = await evaluateAllureQualityGate({
      runner,
      projectRoot: workdir,
      allureResultsDest,
      profile: "local-review"
    });

    expect(outcome.status).toBe("skipped");
    expect(outcome.failureMode).toBe("binary-missing");
    expect(outcome.persisted).toBeUndefined();
    expect(spawned).toHaveLength(0);
  });

  it("returns status='passed' on exit 0 and a persistable QualityGateResult", async () => {
    const { allureResultsDest } = setupAllureBinary();
    const { runner, spawned } = fakeRunner({
      exitCode: 0,
      signal: null,
      stdout: "Quality gate passed",
      stderr: "",
      durationMs: 250
    });

    const outcome = await evaluateAllureQualityGate({
      runner,
      projectRoot: workdir,
      allureResultsDest,
      profile: "local-review"
    });

    expect(outcome.status).toBe("passed");
    expect(outcome.exitCode).toBe(0);
    expect(outcome.failureMode).toBeUndefined();
    expect(outcome.persisted).toBeDefined();
    expect(outcome.persisted?.status).toBe("passed");
    expect(outcome.persisted?.profile).toBe("local-review");
    expect(outcome.persisted?.stdout).toBe("Quality gate passed");
    expect(outcome.persisted?.exitCode).toBe(0);
    // Argv shape verification.
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.spec.args).toEqual([
      "quality-gate",
      ".playwright-workbench/runs/r1/allure-results"
    ]);
  });

  it("returns status='failed' on exit 1 (gate violated)", async () => {
    const { allureResultsDest } = setupAllureBinary();
    const { runner } = fakeRunner({
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: "Gate failed",
      durationMs: 200
    });

    const outcome = await evaluateAllureQualityGate({
      runner,
      projectRoot: workdir,
      allureResultsDest,
      profile: "release-smoke"
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.persisted?.status).toBe("failed");
    expect(outcome.persisted?.profile).toBe("release-smoke");
    expect(outcome.persisted?.stderr).toBe("Gate failed");
  });

  it("returns status='error' with exit-other failure mode on unexpected exit codes", async () => {
    const { allureResultsDest } = setupAllureBinary();
    const { runner } = fakeRunner({
      exitCode: 2,
      signal: null,
      stdout: "",
      stderr: "Internal error",
      durationMs: 100
    });

    const outcome = await evaluateAllureQualityGate({
      runner,
      projectRoot: workdir,
      allureResultsDest,
      profile: "local-review"
    });

    expect(outcome.status).toBe("error");
    expect(outcome.failureMode).toBe("exit-other");
    expect(outcome.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("exitCode=2")])
    );
  });

  it("returns status='error' with timeout failure mode on subprocess timeout", async () => {
    const { allureResultsDest } = setupAllureBinary();
    const { runner } = fakeRunner({
      exitCode: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
      durationMs: 30_000,
      timedOut: true
    });

    const outcome = await evaluateAllureQualityGate({
      runner,
      projectRoot: workdir,
      allureResultsDest,
      profile: "local-review",
      timeoutMs: 30_000
    });

    expect(outcome.status).toBe("error");
    expect(outcome.failureMode).toBe("timeout");
    expect(outcome.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("timed out after 30000ms")])
    );
  });

  it.each([
    ["EACCES"],
    ["EMFILE"],
    ["ENFILE"],
    ["ENOSPC"],
    ["EDQUOT"],
    ["EROFS"],
    ["EIO"]
  ])(
    "propagates FATAL_OPERATIONAL_CODE %s instead of swallowing into a warning",
    async (fatalCode) => {
      const { allureResultsDest } = setupAllureBinary();
      const { runner } = fakeRunner({
        exitCode: 0,
        signal: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        rejection: Object.assign(new Error(`simulated ${fatalCode}`), {
          code: fatalCode
        })
      });

      await expect(
        evaluateAllureQualityGate({
          runner,
          projectRoot: workdir,
          allureResultsDest,
          profile: "local-review"
        })
      ).rejects.toMatchObject({ code: fatalCode });
    }
  );

  it("threads thresholds and known-issues through to the argv", async () => {
    const { allureResultsDest } = setupAllureBinary();
    const { runner, spawned } = fakeRunner({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 50
    });

    await evaluateAllureQualityGate({
      runner,
      projectRoot: workdir,
      allureResultsDest,
      profile: "full-regression",
      rules: { maxFailures: 0, successRate: 95, minTestsCount: 1, fastFail: true },
      knownIssuesPath: path.join(workdir, ".playwright-workbench/reports/known-issues.json")
    });

    expect(spawned[0]!.spec.args).toEqual([
      "quality-gate",
      ".playwright-workbench/runs/r1/allure-results",
      "--max-failures",
      "0",
      "--min-tests-count",
      "1",
      "--success-rate",
      "95",
      "--fast-fail",
      "--known-issues",
      ".playwright-workbench/reports/known-issues.json"
    ]);
  });
});

describe("persistQualityGateResult", () => {
  it("writes a JSON-serialized QualityGateResult to the given path", async () => {
    const target = path.join(workdir, ".playwright-workbench/runs/r1/quality-gate-result.json");
    await persistQualityGateResult(target, {
      status: "passed",
      profile: "local-review",
      evaluatedAt: "2026-04-29T01:00:00Z",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      warnings: []
    });

    expect(fs.existsSync(target)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(target, "utf8")) as {
      status: string;
      profile: string;
      exitCode: number;
    };
    expect(parsed.status).toBe("passed");
    expect(parsed.profile).toBe("local-review");
    expect(parsed.exitCode).toBe(0);
  });

  it("creates parent directories on demand", async () => {
    const target = path.join(workdir, "deeply", "nested", "qg.json");
    await persistQualityGateResult(target, {
      status: "failed",
      profile: "release-smoke",
      evaluatedAt: "2026-04-29T01:00:00Z",
      exitCode: 1,
      stdout: "",
      stderr: "violated",
      warnings: ["x"]
    });
    expect(fs.existsSync(target)).toBe(true);
  });
});
