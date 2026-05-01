import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FailureReviewResponse, RunMetadata } from "@pwqa/shared";
import { buildAiAnalysisContext } from "../src/ai/analysisContext.js";
import { runPathsFor } from "../src/storage/paths.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-ai-context-")));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("buildAiAnalysisContext", () => {
  it("builds a redacted failure context from run metadata and failure review", async () => {
    const run = makeRun("r1");
    fs.mkdirSync(run.paths.runDir, { recursive: true });
    fs.writeFileSync(run.paths.stdoutLog, `ok\napi_key=sk-${"a".repeat(24)}\n`);
    fs.writeFileSync(run.paths.stderrLog, `${workdir}/tests/example.spec.ts: expected visible\n`);

    const review = makeFailureReview(run);
    const context = await buildAiAnalysisContext({ run, failureReview: review });

    expect(context.runId).toBe("r1");
    expect(context.failures).toHaveLength(1);
    expect(context.failures[0]?.location?.relativePath).toBe("tests/example.spec.ts");
    expect(context.failures[0]?.stack).toContain("<projectRoot>");
    expect(context.failures[0]?.stack).not.toContain(workdir);
    expect(context.failures[0]?.knownIssues[0]?.title).toBe("Tracked checkout issue");
    expect(context.failures[0]?.flaky.isCandidate).toBe(true);
    expect(context.logs.map((log) => log.stream)).toEqual(["stdout", "stderr"]);
    expect(context.logs[0]?.text).toContain("<REDACTED>");
    expect(JSON.stringify(context)).not.toContain(workdir);
    expect(JSON.stringify(context)).not.toContain("sk-");
  });

  it("drops locations outside the project root and keeps only artifact basenames", async () => {
    const run = makeRun("r2");
    const outside = path.join(os.tmpdir(), "outside.spec.ts");
    const review = makeFailureReview(run, { filePath: outside, attachmentPath: outside });
    const context = await buildAiAnalysisContext({ run, failureReview: review });

    expect(context.failures[0]?.location).toBeUndefined();
    expect(context.failures[0]?.attachments[0]?.path).toBe("outside.spec.ts");
  });

  it("returns bounded log tails", async () => {
    const run = makeRun("r3");
    fs.mkdirSync(run.paths.runDir, { recursive: true });
    fs.writeFileSync(run.paths.stdoutLog, `${"x".repeat(20_000)}tail`);

    const context = await buildAiAnalysisContext({
      run,
      failureReview: { ...makeFailureReview(run), failedTests: [] }
    });

    expect(context.logs[0]?.truncated).toBe(true);
    expect(context.logs[0]?.text.endsWith("tail")).toBe(true);
    expect(context.logs[0]?.text.length).toBeLessThanOrEqual(8 * 1024);
  });
});

function makeRun(runId: string): RunMetadata {
  return {
    runId,
    projectId: workdir,
    projectRoot: workdir,
    status: "failed",
    startedAt: "2026-05-01T00:00:00Z",
    completedAt: "2026-05-01T00:01:00Z",
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
      failedTests: []
    },
    warnings: [`warning from ${workdir}`]
  };
}

function makeFailureReview(
  run: RunMetadata,
  overrides: { filePath?: string; attachmentPath?: string } = {}
): FailureReviewResponse {
  const filePath = overrides.filePath ?? path.join(workdir, "tests/example.spec.ts");
  return {
    runId: run.runId,
    projectId: run.projectId,
    status: run.status,
    completedAt: run.completedAt,
    warnings: [],
    failedTests: [
      {
        test: {
          testId: "test-1",
          title: "checkout fails",
          fullTitle: "checkout > checkout fails",
          filePath,
          line: 10,
          column: 3,
          status: "failed",
          message: `token=${"b".repeat(24)}`,
          stack: `Error at ${workdir}/tests/example.spec.ts:10:3`,
          attachments: [
            {
              kind: "trace",
              label: "trace file",
              path: overrides.attachmentPath ?? path.join(workdir, "trace.zip")
            }
          ]
        },
        history: [
          { generatedAt: "2026-05-01T00:00:00Z", status: "passed" },
          { generatedAt: "2026-05-01T00:01:00Z", status: "failed" }
        ],
        knownIssues: [
          {
            id: "known-1",
            title: "Tracked checkout issue",
            historyId: "hist-1"
          }
        ],
        flaky: {
          isCandidate: true,
          passedRuns: 1,
          failedRuns: 1,
          brokenRuns: 0,
          skippedRuns: 0,
          recentStatuses: ["passed", "failed"]
        }
      }
    ]
  };
}
