import { describe, expect, it } from "vitest";
import { buildReleaseReviewDraft } from "../src/reporting/releaseReviewDraft.js";
import type { QmoSummary } from "@pwqa/shared";

function makeQmoSummary(overrides: Partial<QmoSummary> = {}): QmoSummary {
  return {
    runId: "run-1",
    projectId: "project-1",
    generatedAt: "2026-05-01T00:00:00.000Z",
    outcome: "conditional",
    testSummary: {
      total: 3,
      passed: 2,
      failed: 1,
      skipped: 0,
      flaky: 0,
      failedTests: [{ title: "checkout", status: "failed", attachments: [] }]
    },
    qualityGate: {
      status: "passed",
      profile: "release-smoke",
      exitCode: 0,
      warnings: []
    },
    warnings: [],
    reportLinks: {
      allureReportDir: "/runs/run-1/allure-report",
      qualityGateResultPath: "/runs/run-1/quality-gate-result.json"
    },
    runDurationMs: 12_000,
    command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
    ...overrides
  };
}

describe("buildReleaseReviewDraft", () => {
  it("renders QMO, GitHub, and CI artifact context into a stable markdown draft", () => {
    const draft = buildReleaseReviewDraft({
      qmoSummary: makeQmoSummary(),
      generatedAt: "2026-05-01T01:00:00.000Z",
      request: {
        pullRequest: {
          repository: "owner/repo",
          number: 42,
          title: "Release smoke",
          author: "qa-lead",
          url: "https://github.com/owner/repo/pull/42"
        },
        issues: [
          {
            repository: "owner/repo",
            number: 7,
            title: "Known checkout issue",
            state: "open",
            url: "https://github.com/owner/repo/issues/7"
          }
        ],
        ciArtifacts: [
          {
            name: "playwright-report",
            kind: "playwright-report",
            source: "github-actions",
            workflowRunId: 123,
            url: "https://github.com/owner/repo/actions/runs/123/artifacts/456"
          }
        ]
      }
    });

    expect(draft.outcome).toBe("conditional");
    expect(draft.markdown).toContain("# Release Readiness Review");
    expect(draft.markdown).toContain("owner/repo#42 Release smoke by qa-lead");
    expect(draft.markdown).toContain("owner/repo#7 Known checkout issue [open]");
    expect(draft.markdown).toContain("playwright-report (playwright-report, github-actions)");
    expect(draft.markdown).toContain("Allure report: `/runs/run-1/allure-report`");
  });

  it("keeps markdown structure stable when optional links are absent", () => {
    const draft = buildReleaseReviewDraft({
      qmoSummary: makeQmoSummary({ testSummary: undefined, qualityGate: undefined, reportLinks: {} }),
      generatedAt: "2026-05-01T01:00:00.000Z",
      request: { issues: [], ciArtifacts: [] }
    });

    expect(draft.markdown).toContain("- Tests: summary unavailable");
    expect(draft.markdown).toContain("- PR: not linked");
    expect(draft.markdown).toContain("- No CI artifacts linked.");
    expect(draft.markdown).toContain("- No Workbench artifact links verified for this run.");
  });
});
