import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRuns, runAiAnalysis } from "@/api/client";

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
