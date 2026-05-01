import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyPatchTemporary,
  checkPatch,
  createReleaseReviewDraft,
  fetchRepairComparison,
  fetchRuns,
  revertPatchTemporary,
  runAiAnalysis,
  startRepairRerun
} from "@/api/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api/client fetchRuns", () => {
  it("preserves warnings from run list items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            runs: [
              {
                runId: "r1",
                projectId: "p1",
                status: "passed",
                startedAt: "2026-04-28T00:00:00Z",
                completedAt: "2026-04-28T00:00:01Z",
                durationMs: 1000,
                exitCode: 0,
                warnings: ["summary unavailable. code=ENOENT"]
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    await expect(fetchRuns()).resolves.toEqual({
      runs: [
        expect.objectContaining({
          runId: "r1",
          warnings: ["summary unavailable. code=ENOENT"]
        })
      ]
    });
  });
});

describe("api/client runAiAnalysis", () => {
  it("posts to the AI analysis endpoint and validates the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            runId: "r1",
            projectId: "<projectRoot>",
            provider: "claude-code",
            generatedAt: "2026-05-01T00:00:00Z",
            analysis: {
              classification: "test-bug",
              rootCause: "Locator drift",
              evidence: ["assertion mismatch"],
              risk: ["test-only change"],
              filesTouched: ["tests/example.spec.ts"],
              confidence: 0.8,
              requiresHumanDecision: false
            },
            warnings: []
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    await expect(runAiAnalysis("r1")).resolves.toMatchObject({
      runId: "r1",
      analysis: { classification: "test-bug" }
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/r1/ai-analysis",
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("api/client repair review", () => {
  it("posts patch check/apply/revert requests and validates responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, filesTouched: ["a.ts"], dirtyFiles: [], diagnostics: "ok" }))
      .mockResolvedValueOnce(jsonResponse({ applied: true, filesTouched: ["a.ts"], diagnostics: "ok" }))
      .mockResolvedValueOnce(jsonResponse({ reverted: true, filesTouched: ["a.ts"], diagnostics: "ok" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(checkPatch("p1", "diff")).resolves.toMatchObject({ ok: true });
    await expect(applyPatchTemporary("p1", "diff")).resolves.toMatchObject({ applied: true });
    await expect(revertPatchTemporary("p1", "diff")).resolves.toMatchObject({ reverted: true });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/patches/check",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/patches/apply-temporary",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/patches/revert-temporary",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("starts repair rerun and treats missing comparison as pending", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        baselineRunId: "run-before-11111111",
        rerunId: "run-after-22222222",
        status: "queued",
        comparisonPath: "/tmp/comparison.json"
      }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "NO_REPAIR_COMPARISON", message: "pending" } }, 409));
    vi.stubGlobal("fetch", fetchMock);

    await expect(startRepairRerun("run-before-11111111")).resolves.toMatchObject({
      rerunId: "run-after-22222222"
    });
    await expect(fetchRepairComparison("run-before-11111111", "run-after-22222222")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/runs/run-before-11111111/repair-rerun",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/runs/run-before-11111111/repair-comparison/run-after-22222222"
    );
  });
});

describe("api/client createReleaseReviewDraft", () => {
  it("posts draft links and validates the release review draft response", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      runId: "run-1",
      projectId: "p1",
      generatedAt: "2026-05-01T00:00:00.000Z",
      outcome: "ready",
      qmoSummary: {
        runId: "run-1",
        projectId: "p1",
        generatedAt: "2026-05-01T00:00:00.000Z",
        outcome: "ready",
        warnings: [],
        reportLinks: {}
      },
      issues: [],
      ciArtifacts: [],
      markdown: "# Release Readiness Review\n"
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createReleaseReviewDraft("run-1", { issues: [], ciArtifacts: [] })).resolves.toMatchObject({
      runId: "run-1",
      outcome: "ready"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/release-review-draft",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("treats missing QMO summary as a pending draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { code: "NO_QMO_SUMMARY", message: "pending" } }, 409))
    );

    await expect(createReleaseReviewDraft("run-1", { issues: [], ciArtifacts: [] })).resolves.toBeNull();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
