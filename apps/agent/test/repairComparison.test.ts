import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { FailedTest, RunMetadata, TestResultSummary } from "@pwqa/shared";
import { runPathsFor } from "../src/storage/paths.js";
import {
  buildRepairComparison,
  persistRepairComparison,
  readRepairComparison,
  repairComparisonPathFor
} from "../src/repair/repairComparison.js";

function failedTest(title: string, testId = title): FailedTest {
  return {
    testId,
    title,
    status: "failed",
    attachments: []
  };
}

function summary(failedTests: FailedTest[]): TestResultSummary {
  return {
    total: 3,
    passed: 3 - failedTests.length,
    failed: failedTests.length,
    skipped: 0,
    flaky: 0,
    failedTests
  };
}

function metadata(root: string, runId: string, failedTests: FailedTest[]): RunMetadata {
  return {
    runId,
    projectId: root,
    projectRoot: root,
    status: failedTests.length === 0 ? "passed" : "failed",
    startedAt: "2026-05-01T00:00:00.000Z",
    completedAt: "2026-05-01T00:00:01.000Z",
    command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
    cwd: root,
    exitCode: failedTests.length === 0 ? 0 : 1,
    signal: null,
    durationMs: 1_000,
    requested: { projectId: root, headed: false },
    paths: runPathsFor(root, runId),
    summary: summary(failedTests),
    warnings: []
  };
}

describe("repair comparison (T600-2)", () => {
  it("classifies fixed reruns and records resolved failures", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-repair-")));
    try {
      const before = metadata(root, "run-before-11111111", [failedTest("checkout fails")]);
      const after = metadata(root, "run-after-22222222", []);

      const comparison = buildRepairComparison({
        baseline: before,
        rerun: after,
        generatedAt: "2026-05-01T00:00:02.000Z"
      });

      expect(comparison.verdict).toBe("fixed");
      expect(comparison.delta).toEqual({ total: 0, passed: 1, failed: -1, skipped: 0, flaky: 0 });
      expect(comparison.resolvedFailures).toHaveLength(1);
      expect(comparison.remainingFailures).toEqual([]);
      expect(comparison.newFailures).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("classifies reruns with new failures as regressed", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-repair-")));
    try {
      const before = metadata(root, "run-before-11111111", [failedTest("checkout fails", "a")]);
      const after = metadata(root, "run-after-22222222", [
        failedTest("checkout fails", "a"),
        failedTest("settings fails", "b")
      ]);

      const comparison = buildRepairComparison({ baseline: before, rerun: after });

      expect(comparison.verdict).toBe("regressed");
      expect(comparison.remainingFailures).toHaveLength(1);
      expect(comparison.newFailures).toHaveLength(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists and reads comparison artifacts under the baseline run", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-repair-")));
    try {
      const before = metadata(root, "run-before-11111111", [failedTest("checkout fails")]);
      const after = metadata(root, "run-after-22222222", []);

      await persistRepairComparison({ baseline: before, rerun: after });
      const target = repairComparisonPathFor(before, after.runId);
      const readBack = await readRepairComparison(before, after.runId);

      expect(target).toBe(path.join(before.paths.runDir, "reruns", after.runId, "comparison.json"));
      expect(readBack.verdict).toBe("fixed");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe rerun id path segments", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-repair-")));
    try {
      const before = metadata(root, "run-before-11111111", []);

      expect(() => repairComparisonPathFor(before, "../outside")).toThrow(/valid run id/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
