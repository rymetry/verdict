import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateAllureReport } from "../src/playwright/allureReportGenerator.js";
import type {
  CommandHandle,
  CommandRunner,
  CommandSpec,
  CommandStreamHandlers
} from "../src/commands/runner.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-allure-gen-")));
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
    run(spec: CommandSpec, _handlers: CommandStreamHandlers = {}): CommandHandle {
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

function setupAllureBinary(): { allureResultsDest: string; allureReportDir: string } {
  // Create the allure binary stub at the path the generator pre-checks.
  const binDir = path.join(workdir, "node_modules", ".bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "allure"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(binDir, "allure"), 0o755);
  // Pre-create the run-scoped directories so the absolute paths used
  // by the generator look realistic.
  const runDir = path.join(workdir, ".playwright-workbench", "runs", "r1");
  const allureResultsDest = path.join(runDir, "allure-results");
  const allureReportDir = path.join(runDir, "allure-report");
  fs.mkdirSync(allureResultsDest, { recursive: true });
  return { allureResultsDest, allureReportDir };
}

describe("generateAllureReport", () => {
  it("returns ok=false with a single warning when the Allure CLI is not installed", async () => {
    const allureResultsDest = path.join(workdir, ".playwright-workbench/runs/r1/allure-results");
    const allureReportDir = path.join(workdir, ".playwright-workbench/runs/r1/allure-report");
    const { runner, spawned } = fakeRunner({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 0
    });

    const outcome = await generateAllureReport({
      runner,
      projectRoot: workdir,
      allureResultsDest,
      allureReportDir
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.failureMode).toBe("binary-missing");
    // Warning text uses the literal `<projectRoot>` placeholder (not an
    // interpolated absolute path) so log aggregators do not learn the
    // user's filesystem layout from a missing-CLI signal.
    expect(outcome.warnings).toEqual([
      "Allure CLI not found at <projectRoot>/node_modules/.bin/allure; HTML report generation skipped."
    ]);
    expect(spawned).toHaveLength(0);
    expect(outcome.exitCode).toBeNull();
  });

  it("invokes `allure generate` with project-relative paths and the canonical flags", async () => {
    const { allureResultsDest, allureReportDir } = setupAllureBinary();
    const { runner, spawned } = fakeRunner({
      exitCode: 0,
      signal: null,
      stdout: "Report generated",
      stderr: "",
      durationMs: 1234
    });

    const outcome = await generateAllureReport({
      runner,
      projectRoot: workdir,
      allureResultsDest,
      allureReportDir
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.failureMode).toBeUndefined();
    expect(outcome.exitCode).toBe(0);
    expect(outcome.reportPath).toBe(allureReportDir);
    expect(outcome.durationMs).toBe(1234);
    expect(outcome.warnings).toEqual([]);
    expect(spawned).toHaveLength(1);
    const captured = spawned[0]!;
    expect(captured.spec.executable).toBe(path.join(workdir, "node_modules/.bin/allure"));
    expect(captured.spec.args).toEqual([
      "generate",
      ".playwright-workbench/runs/r1/allure-results",
      "-o",
      ".playwright-workbench/runs/r1/allure-report"
    ]);
    expect(captured.spec.cwd).toBe(workdir);
    expect(captured.spec.label).toBe("allure-generate");
    expect(captured.spec.timeoutMs).toBe(60_000);
  });

  it("treats a non-zero exit code as failure and surfaces an exitCode warning", async () => {
    const { allureResultsDest, allureReportDir } = setupAllureBinary();
    const { runner } = fakeRunner({
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: "boom",
      durationMs: 800
    });

    const outcome = await generateAllureReport({
      runner,
      projectRoot: workdir,
      allureResultsDest,
      allureReportDir
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.failureMode).toBe("exit-nonzero");
    expect(outcome.exitCode).toBe(1);
    expect(outcome.reportPath).toBeUndefined();
    expect(outcome.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("exitCode=1")
      ])
    );
    // Verbatim stdout/stderr are no longer surfaced via the outcome —
    // the helper only returns path-redacted warnings + structured
    // metadata. Future T207 (QMO summary) will re-add a redacted
    // diagnostic channel.
    expect(outcome).not.toHaveProperty("stdout");
    expect(outcome).not.toHaveProperty("stderr");
  });

  it("surfaces a timeout warning when the subprocess timed out", async () => {
    const { allureResultsDest, allureReportDir } = setupAllureBinary();
    const { runner } = fakeRunner({
      exitCode: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
      durationMs: 60_000,
      timedOut: true
    });

    const outcome = await generateAllureReport({
      runner,
      projectRoot: workdir,
      allureResultsDest,
      allureReportDir,
      timeoutMs: 60_000
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.failureMode).toBe("timeout");
    expect(outcome.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("timed out after 60000ms")
      ])
    );
  });

  it("returns a structured outcome (no throw) when the runner rejects with a non-fatal code", async () => {
    const { allureResultsDest, allureReportDir } = setupAllureBinary();
    const { runner } = fakeRunner({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 0,
      rejection: Object.assign(new Error("simulated policy failure"), {
        code: "POLICY_REJECTED"
      })
    });

    const outcome = await generateAllureReport({
      runner,
      projectRoot: workdir,
      allureResultsDest,
      allureReportDir
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.failureMode).toBe("spawn-error");
    expect(outcome.errorCode).toBe("POLICY_REJECTED");
    expect(outcome.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("code=POLICY_REJECTED")
      ])
    );
  });

  it("does not pass unsupported history flags to Allure 3.6 when historyPath is provided", async () => {
    const { allureResultsDest, allureReportDir } = setupAllureBinary();
    const { runner, spawned } = fakeRunner({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 5
    });

    await generateAllureReport({
      runner,
      projectRoot: workdir,
      allureResultsDest,
      allureReportDir,
      historyPath: path.join(workdir, ".playwright-workbench/reports/allure-history.jsonl")
    });

    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.spec.args).toEqual([
      "generate",
      ".playwright-workbench/runs/r1/allure-results",
      "-o",
      ".playwright-workbench/runs/r1/allure-report"
    ]);
  });

  it("omits --history-path when historyPath is undefined (back-compat)", async () => {
    const { allureResultsDest, allureReportDir } = setupAllureBinary();
    const { runner, spawned } = fakeRunner({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: 5
    });

    await generateAllureReport({
      runner,
      projectRoot: workdir,
      allureResultsDest,
      allureReportDir
      // historyPath intentionally omitted
    });

    expect(spawned[0]!.spec.args).not.toContain("--history-path");
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
      const { allureResultsDest, allureReportDir } = setupAllureBinary();
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

      // Operator-action conditions throw rather than producing an
      // aggregated warning. Mirrors T203-2 review fix for the same
      // anti-pattern in runArtifactsStore.ts.
      await expect(
        generateAllureReport({
          runner,
          projectRoot: workdir,
          allureResultsDest,
          allureReportDir
        })
      ).rejects.toMatchObject({ code: fatalCode });
    }
  );
});
