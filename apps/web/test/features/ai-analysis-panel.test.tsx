import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AiAnalysisResponse } from "@pwqa/shared";

import { AiAnalysisPanel } from "@/features/ai-analysis/AiAnalysisPanel";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, runAiAnalysis: vi.fn() };
});
import { runAiAnalysis } from "@/api/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(runAiAnalysis).mockReset();
});

function renderPanel(runId: string | null): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <AiAnalysisPanel runId={runId} />
    </QueryClientProvider>
  );
}

describe("AiAnalysisPanel", () => {
  it("runId=null のとき実行ボタンを出さない", () => {
    renderPanel(null);
    expect(screen.getByText(/Run を開始すると AI analysis/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Analyze failure/ })).not.toBeInTheDocument();
  });

  it("button click で AI analysis を実行し validated result を表示する", async () => {
    vi.mocked(runAiAnalysis).mockResolvedValue(makeAiAnalysisResponse());
    renderPanel("r1");

    await userEvent.click(screen.getByRole("button", { name: /Analyze failure/ }));

    expect(await screen.findByText("test-bug")).toBeInTheDocument();
    expect(screen.getByText("Locator drift")).toBeInTheDocument();
    expect(screen.getByText("assertion mismatch")).toBeInTheDocument();
    expect(screen.getByText("test-only change")).toBeInTheDocument();
    expect(screen.getByText("tests/example.spec.ts")).toBeInTheDocument();
    expect(screen.getByText("confidence 80%")).toBeInTheDocument();
    expect(screen.getByText("Patch proposal is not included.")).toBeInTheDocument();
    expect(vi.mocked(runAiAnalysis)).toHaveBeenCalledWith("r1");
  });

  it("proposedPatch があるとき diff block を表示する", async () => {
    vi.mocked(runAiAnalysis).mockResolvedValue(
      makeAiAnalysisResponse({
        proposedPatch: "diff --git a/tests/example.spec.ts b/tests/example.spec.ts"
      })
    );
    renderPanel("r1");

    await userEvent.click(screen.getByRole("button", { name: /Analyze failure/ }));

    expect(await screen.findByText("Proposed patch")).toBeInTheDocument();
    expect(screen.getByText(/diff --git/)).toBeInTheDocument();
  });

  it("error 時は Alert と console.error の両方", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runAiAnalysis).mockRejectedValue(new Error("ai failed"));
    renderPanel("r1");

    await userEvent.click(screen.getByRole("button", { name: /Analyze failure/ }));

    expect(await screen.findByText("AI analysis failed")).toBeInTheDocument();
    expect(screen.getByText("ai failed")).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalled();
  });
});

function makeAiAnalysisResponse(
  analysisOverrides: Partial<AiAnalysisResponse["analysis"]> = {}
): AiAnalysisResponse {
  return {
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
      requiresHumanDecision: false,
      ...analysisOverrides
    },
    warnings: []
  };
}
