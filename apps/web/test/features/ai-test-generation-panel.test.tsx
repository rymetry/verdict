import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AiTestGenerationResponse } from "@pwqa/shared";

import { AiTestGenerationPanel } from "@/features/ai-test-generation/AiTestGenerationPanel";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, runAiTestGeneration: vi.fn() };
});
import { runAiTestGeneration } from "@/api/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(runAiTestGeneration).mockReset();
});

function renderPanel(runId: string | null): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <AiTestGenerationPanel runId={runId} />
    </QueryClientProvider>
  );
}

describe("AiTestGenerationPanel", () => {
  it("runId=null のとき実行ボタンを出さない", () => {
    renderPanel(null);

    expect(screen.getByText(/Run を開始すると AI test generation/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate tests/ })).not.toBeInTheDocument();
  });

  it("mode objective targetFiles を送信し、生成 diff を repair review に流す", async () => {
    vi.mocked(runAiTestGeneration).mockResolvedValue(makeGenerationResponse());
    renderPanel("r1");

    await userEvent.selectOptions(screen.getByLabelText("Mode"), "healer");
    await userEvent.clear(screen.getByLabelText("Objective"));
    await userEvent.type(screen.getByLabelText("Objective"), "Generate checkout regression.");
    await userEvent.type(
      screen.getByLabelText("Target files"),
      "tests/generated.spec.ts, tests/checkout.spec.ts"
    );
    await userEvent.click(screen.getByRole("button", { name: /Generate tests/ }));

    expect((await screen.findAllByText("healer")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("review ready")).toBeInTheDocument();
    expect(screen.getByText("Add generated checkout coverage")).toBeInTheDocument();
    expect(screen.getByText("tests/generated.spec.ts")).toBeInTheDocument();
    expect(screen.getByText("Proposed patch")).toBeInTheDocument();
    expect(screen.getByText(/diff --git/)).toBeInTheDocument();
    expect(vi.mocked(runAiTestGeneration)).toHaveBeenCalledWith("r1", {
      mode: "healer",
      objective: "Generate checkout regression.",
      targetFiles: ["tests/generated.spec.ts", "tests/checkout.spec.ts"]
    });
  });

  it("proposedPatch がないとき diff review を表示しない", async () => {
    vi.mocked(runAiTestGeneration).mockResolvedValue(
      makeGenerationResponse({ proposedPatch: undefined, requiresHumanDecision: true })
    );
    renderPanel("r1");

    await userEvent.click(screen.getByRole("button", { name: /Generate tests/ }));

    expect(await screen.findByText("human decision")).toBeInTheDocument();
    expect(screen.getByText("Generated diff is not included.")).toBeInTheDocument();
    expect(screen.queryByText("Proposed patch")).not.toBeInTheDocument();
  });

  it("error 時は Alert と console.error の両方", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(runAiTestGeneration).mockRejectedValue(new Error("generation failed"));
    renderPanel("r1");

    await userEvent.click(screen.getByRole("button", { name: /Generate tests/ }));

    expect(await screen.findByText("AI test generation failed")).toBeInTheDocument();
    expect(screen.getByText("generation failed")).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalled();
  });
});

function makeGenerationResponse(
  resultOverrides: Partial<AiTestGenerationResponse["result"]> = {}
): AiTestGenerationResponse {
  return {
    runId: "r1",
    projectId: "<projectRoot>",
    provider: "claude-code",
    mode: "healer",
    generatedAt: "2026-05-01T00:00:00Z",
    result: {
      plan: ["Add generated checkout coverage"],
      proposedPatch: "diff --git a/tests/generated.spec.ts b/tests/generated.spec.ts\n",
      filesTouched: ["tests/generated.spec.ts"],
      evidence: ["failure context references checkout"],
      risk: ["test-only change"],
      confidence: 0.72,
      requiresHumanDecision: false,
      ...resultOverrides
    },
    warnings: []
  };
}
