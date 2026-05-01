import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyPatchTemporary,
  checkPatch,
  createPlaywrightLaunchCommand,
  createReleaseReviewDraft,
  fetchConfigSummary,
  fetchRepairComparison,
  fetchRuns,
  importCiArtifacts,
  revertPatchTemporary,
  runAiAnalysis,
  runAiTestGeneration,
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

describe("api/client fetchConfigSummary", () => {
  it("fetches and validates the project config summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          projectId: "p1",
          generatedAt: "2026-05-01T00:00:00Z",
          config: {
            path: "/repo/playwright.config.ts",
            relativePath: "playwright.config.ts",
            format: "ts",
            sizeBytes: 128
          },
          reporters: [{ name: "list", source: "heuristic" }],
          useOptions: [{ name: "trace", value: "on-first-retry", source: "heuristic" }],
          fixtureFiles: [
            {
              relativePath: "tests/fixtures/auth.fixture.ts",
              kind: "fixture-file",
              signals: ["fixture-path"],
              sizeBytes: 42
            }
          ],
          authRisks: [
            {
              signal: "storage-state-path",
              severity: "warning",
              message: "storageState file path is configured.",
              relativePath: "playwright/.auth/user.json",
              source: "heuristic"
            }
          ],
          warnings: []
        })
      )
    );

    await expect(fetchConfigSummary("p1")).resolves.toMatchObject({
      config: { relativePath: "playwright.config.ts" },
      fixtureFiles: [{ relativePath: "tests/fixtures/auth.fixture.ts" }],
      authRisks: [{ signal: "storage-state-path" }]
    });
    expect(fetch).toHaveBeenCalledWith("/api/projects/p1/config-summary");
  });
});

describe("api/client createPlaywrightLaunchCommand", () => {
  it("posts a launch command request and validates the response", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      projectId: "p1",
      kind: "ui-mode",
      command: { executable: "pnpm", args: ["exec", "playwright", "test", "--ui"] },
      warnings: []
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createPlaywrightLaunchCommand("p1", { kind: "ui-mode" })
    ).resolves.toMatchObject({
      kind: "ui-mode",
      command: { executable: "pnpm" }
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/playwright-launch-command",
      expect.objectContaining({ method: "POST" })
    );
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

describe("api/client runAiTestGeneration", () => {
  it("posts generation request and validates the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            runId: "r1",
            projectId: "<projectRoot>",
            provider: "claude-code",
            mode: "generator",
            generatedAt: "2026-05-01T00:00:00Z",
            result: {
              plan: ["Add generated coverage"],
              proposedPatch: "diff --git a/tests/generated.spec.ts b/tests/generated.spec.ts\n",
              filesTouched: ["tests/generated.spec.ts"],
              evidence: ["failure context"],
              risk: ["test-only change"],
              confidence: 0.72,
              requiresHumanDecision: false
            },
            warnings: []
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    await expect(
      runAiTestGeneration("r1", {
        mode: "generator",
        objective: "Add generated coverage.",
        targetFiles: ["tests/generated.spec.ts"]
      })
    ).resolves.toMatchObject({
      mode: "generator",
      result: { filesTouched: ["tests/generated.spec.ts"] }
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/runs/r1/ai-test-generation",
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

describe("api/client importCiArtifacts", () => {
  it("posts CI artifact metadata and validates imported links", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      runId: "run-1",
      projectId: "p1",
      imported: [
        {
          name: "allure-report",
          url: "https://github.com/owner/repo/actions/runs/1/artifacts/2",
          source: "github-actions",
          kind: "allure-report"
        }
      ],
      skipped: [],
      warnings: []
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      importCiArtifacts("run-1", {
        artifacts: [
          {
            name: "allure-report",
            url: "https://github.com/owner/repo/actions/runs/1/artifacts/2"
          }
        ]
      })
    ).resolves.toMatchObject({
      imported: [{ kind: "allure-report" }]
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-1/ci-artifacts/import",
      expect.objectContaining({ method: "POST" })
    );
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
