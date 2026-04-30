import { describe, expect, it } from "vitest";
import type { TestResultSummary } from "@pwqa/shared";

import {
  mergeReadSummaryResults,
  type MergeInput,
} from "../src/reporting/compositeReportProvider.js";

function ok(name: string, summary: Partial<TestResultSummary> & {
  failedTests?: TestResultSummary["failedTests"];
}, warnings: string[] = []): MergeInput {
  return {
    provider: name,
    result: {
      summary: {
        total: summary.total ?? 0,
        passed: summary.passed ?? 0,
        failed: summary.failed ?? 0,
        skipped: summary.skipped ?? 0,
        flaky: summary.flaky ?? 0,
        durationMs: summary.durationMs,
        failedTests: summary.failedTests ?? [],
      },
      warnings,
    },
  };
}

function silent(name: string): MergeInput {
  return { provider: name, result: undefined };
}

function failed(name: string, warning: string): MergeInput {
  return { provider: name, result: undefined, failureWarning: warning };
}

describe("mergeReadSummaryResults", () => {
  it("returns undefined when nothing reported", () => {
    expect(mergeReadSummaryResults([silent("a"), silent("b")])).toBeUndefined();
  });

  it("returns the primary's summary unchanged when only one provider reports", () => {
    const result = mergeReadSummaryResults([
      ok("playwright-json", { total: 3, passed: 2, failed: 1 }, ["warn-1"]),
      silent("allure"),
    ]);
    expect(result?.summary.total).toBe(3);
    expect(result?.warnings).toEqual(["warn-1"]);
  });

  it("Playwright JSON counters win when both providers report", () => {
    const result = mergeReadSummaryResults([
      ok("playwright-json", {
        total: 5,
        passed: 4,
        failed: 1,
        durationMs: 1000,
        failedTests: [
          {
            testId: "abc",
            title: "broken",
            fullTitle: "s > broken",
            status: "failed",
            attachments: [{ kind: "screenshot", path: "/r/scr.png", label: "scr" }],
          },
        ],
      }),
      ok("allure", {
        total: 7,
        durationMs: 9999,
        failedTests: [
          {
            testId: "abc",
            title: "broken",
            fullTitle: "s > broken",
            status: "broken",
            attachments: [
              { kind: "trace", path: "/r/t.zip", label: "trace" },
              { kind: "log", path: "/r/log.txt", label: "log" },
            ],
          },
        ],
      }),
    ]);
    expect(result?.summary.total).toBe(5);
    expect(result?.summary.durationMs).toBe(1000);
    expect(result?.summary.failedTests[0]?.status).toBe("failed");
    const paths = (result?.summary.failedTests[0]?.attachments ?? []).map((a) => a.path).sort();
    expect(paths).toEqual(["/r/log.txt", "/r/scr.png", "/r/t.zip"]);
  });

  it("falls back to Allure when Playwright JSON yields nothing", () => {
    const result = mergeReadSummaryResults([
      silent("playwright-json"),
      ok("allure", { total: 2, passed: 1, failed: 1 }),
    ]);
    expect(result?.summary.total).toBe(2);
  });

  it("propagates failureWarning even when no summary was produced (degrade gracefully)", () => {
    const result = mergeReadSummaryResults([
      failed("playwright-json", "playwright-json report read failed; summary unavailable. code=ENOENT"),
      silent("allure"),
    ]);
    expect(result?.summary.total).toBe(0);
    expect(result?.warnings[0]).toMatch(/code=ENOENT/);
  });

  it("prefixes warnings with provider name only when more than one provider contributed", () => {
    const result = mergeReadSummaryResults([
      ok("playwright-json", { total: 1 }, ["bare-warning"]),
      ok("allure", { total: 1 }, ["allure: ALLURE_BROKEN_TEST: foo"]),
    ]);
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        "[playwright-json] bare-warning",
        "allure: ALLURE_BROKEN_TEST: foo",
      ])
    );
  });

  it("matches failedTests by fullTitle when only one side has testId", () => {
    const result = mergeReadSummaryResults([
      ok("playwright-json", {
        total: 1,
        failed: 1,
        failedTests: [
          {
            title: "broken",
            fullTitle: "suite > broken",
            status: "failed",
            attachments: [],
          },
        ],
      }),
      ok("allure", {
        total: 1,
        failed: 1,
        failedTests: [
          {
            testId: "uuid-allure",
            title: "broken",
            fullTitle: "suite > broken",
            status: "broken",
            attachments: [{ kind: "trace", path: "/r/t.zip", label: "trace" }],
          },
        ],
      }),
    ]);
    const attachments = result?.summary.failedTests[0]?.attachments ?? [];
    expect(attachments.map((a) => a.path)).toContain("/r/t.zip");
  });

  it("does not duplicate attachments already on the primary", () => {
    const result = mergeReadSummaryResults([
      ok("playwright-json", {
        total: 1,
        failed: 1,
        failedTests: [
          {
            title: "x",
            fullTitle: "x",
            status: "failed",
            attachments: [{ kind: "trace", path: "/r/t.zip", label: "trace" }],
          },
        ],
      }),
      ok("allure", {
        total: 1,
        failed: 1,
        failedTests: [
          {
            title: "x",
            fullTitle: "x",
            status: "broken",
            attachments: [{ kind: "trace", path: "/r/t.zip", label: "trace" }],
          },
        ],
      }),
    ]);
    expect(result?.summary.failedTests[0]?.attachments).toHaveLength(1);
  });
});
