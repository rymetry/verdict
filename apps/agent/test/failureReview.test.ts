import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunMetadata } from "@pwqa/shared";
import { buildFailureReview } from "../src/reporting/failureReview.js";
import { runPathsFor, workbenchPaths } from "../src/storage/paths.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-failure-review-")));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("buildFailureReview", () => {
  it("enriches failed tests with Allure per-test history, known issues, and flaky signals", async () => {
    const run = makeRun("r1");
    fs.mkdirSync(run.paths.allureResultsDest, { recursive: true });
    fs.writeFileSync(
      path.join(run.paths.allureResultsDest, "uuid-result.json"),
      JSON.stringify({
        uuid: "allure-uuid",
        historyId: "hist-checkout",
        testCaseId: "case-checkout",
        fullName: "checkout > should checkout",
        name: "should checkout",
        status: "failed"
      })
    );

    const paths = workbenchPaths(workdir);
    fs.mkdirSync(paths.reportsDir, { recursive: true });
    fs.writeFileSync(
      paths.allureHistoryPath,
      [
        JSON.stringify({
          generatedAt: "2026-04-30T00:00:00Z",
          testResults: {
            "hist-checkout": { status: "passed" }
          }
        }),
        JSON.stringify({
          generatedAt: "2026-04-30T00:10:00Z",
          testResults: {
            "hist-checkout": { status: "failed" }
          }
        })
      ].join("\n") + "\n"
    );
    fs.writeFileSync(
      paths.knownIssuesPath,
      JSON.stringify([
        {
          historyId: "hist-checkout",
          title: "Checkout timeout is tracked",
          status: "open"
        }
      ])
    );

    const review = await buildFailureReview({ run, projectRoot: workdir });
    expect(review.failedTests).toHaveLength(1);
    expect(review.failedTests[0]?.history.map((h) => h.status)).toEqual([
      "passed",
      "failed"
    ]);
    expect(review.failedTests[0]?.knownIssues[0]).toMatchObject({
      title: "Checkout timeout is tracked",
      historyId: "hist-checkout"
    });
    expect(review.failedTests[0]?.flaky).toMatchObject({
      isCandidate: true,
      passedRuns: 1,
      failedRuns: 1
    });
  });

  it("keeps basic failure data usable when Allure side files are absent", async () => {
    const run = makeRun("r2");
    const review = await buildFailureReview({ run, projectRoot: workdir });
    expect(review.failedTests).toHaveLength(1);
    expect(review.failedTests[0]?.history).toEqual([]);
    expect(review.failedTests[0]?.knownIssues).toEqual([]);
    expect(review.failedTests[0]?.flaky.isCandidate).toBe(false);
    expect(review.warnings).toEqual([]);
  });

  it("surfaces malformed known-issues JSON as a review warning", async () => {
    const run = makeRun("r3");
    const paths = workbenchPaths(workdir);
    fs.mkdirSync(paths.reportsDir, { recursive: true });
    fs.writeFileSync(paths.knownIssuesPath, "{ not json");
    const review = await buildFailureReview({ run, projectRoot: workdir });
    expect(review.warnings.some((warning) => warning.includes("Known issues file"))).toBe(true);
  });

  it("returns project-relative paths for Windows-style failed test paths", async () => {
    const run = makeRun("r4");
    run.projectId = "C:\\repo";
    run.projectRoot = "C:\\repo";
    run.summary!.failedTests[0] = {
      ...run.summary!.failedTests[0]!,
      filePath: "C:\\repo\\tests\\checkout.spec.ts",
      absoluteFilePath: "C:\\repo\\tests\\checkout.spec.ts"
    };

    const review = await buildFailureReview({ run, projectRoot: "C:\\repo" });

    expect(review.failedTests[0]?.test.filePath).toBe("tests/checkout.spec.ts");
    expect(review.failedTests[0]?.test.relativeFilePath).toBe("tests/checkout.spec.ts");
    expect(review.failedTests[0]?.test.absoluteFilePath).toBeUndefined();
  });
});

function makeRun(runId: string): RunMetadata {
  return {
    runId,
    projectId: workdir,
    projectRoot: workdir,
    status: "failed",
    startedAt: "2026-04-30T00:00:00Z",
    completedAt: "2026-04-30T00:01:00Z",
    command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
    cwd: workdir,
    requested: { projectId: workdir, headed: false },
    paths: runPathsFor(workdir, runId),
    summary: {
      total: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      flaky: 0,
      failedTests: [
        {
          testId: "pw-test-id",
          title: "should checkout",
          fullTitle: "checkout > should checkout",
          status: "failed",
          message: "timeout",
          stack: "at tests/checkout.spec.ts:1:1",
          attachments: []
        }
      ]
    },
    warnings: []
  };
}
