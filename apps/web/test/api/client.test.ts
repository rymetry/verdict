import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchRuns } from "@/api/client";

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
