import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RepairComparison } from "@pwqa/shared";

import { RepairReviewPanel } from "@/features/repair-review/RepairReviewPanel";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    checkPatch: vi.fn(),
    applyPatchTemporary: vi.fn(),
    revertPatchTemporary: vi.fn(),
    startRepairRerun: vi.fn(),
    fetchRepairComparison: vi.fn()
  };
});

import {
  applyPatchTemporary,
  checkPatch,
  fetchRepairComparison,
  revertPatchTemporary,
  startRepairRerun
} from "@/api/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(checkPatch).mockReset();
  vi.mocked(applyPatchTemporary).mockReset();
  vi.mocked(revertPatchTemporary).mockReset();
  vi.mocked(startRepairRerun).mockReset();
  vi.mocked(fetchRepairComparison).mockReset();
});

function renderPanel(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <RepairReviewPanel
        runId="run-before-11111111"
        projectId="project-1"
        patch={"diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new"}
      />
    </QueryClientProvider>
  );
}

describe("RepairReviewPanel", () => {
  it("walks through check, temporary apply, rerun, comparison, and approval", async () => {
    vi.mocked(checkPatch).mockResolvedValue({
      ok: true,
      filesTouched: ["a.ts"],
      dirtyFiles: [],
      diagnostics: "ok"
    });
    vi.mocked(applyPatchTemporary).mockResolvedValue({
      applied: true,
      filesTouched: ["a.ts"],
      diagnostics: "ok"
    });
    vi.mocked(startRepairRerun).mockResolvedValue({
      baselineRunId: "run-before-11111111",
      rerunId: "run-after-22222222",
      status: "queued",
      comparisonPath: "/comparison.json"
    });
    vi.mocked(fetchRepairComparison).mockResolvedValue(makeComparison());
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: /^Check$/ }));
    expect(await screen.findByText("Patch check passed")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Apply temp$/ }));
    expect(await screen.findByText("Temporary patch applied")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Rerun$/ }));
    expect(await screen.findByText("Repair rerun started")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Compare$/ }));
    expect(await screen.findByText("Before / after")).toBeInTheDocument();
    expect(screen.getByText("fixed")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Mark approved$/ }));
    expect(await screen.findByText("Approved for the next review step.")).toBeInTheDocument();
  });

  it("keeps apply disabled when patch check reports dirty files", async () => {
    vi.mocked(checkPatch).mockResolvedValue({
      ok: false,
      filesTouched: ["a.ts"],
      dirtyFiles: ["a.ts"],
      diagnostics: "Patch target files have uncommitted changes.",
      reason: "dirty-worktree"
    });
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: /^Check$/ }));

    expect(await screen.findByText("Patch check blocked")).toBeInTheDocument();
    expect(screen.getByText("dirty: a.ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Apply temp$/ })).toBeDisabled();
  });

  it("reverts the temporary patch when rejected", async () => {
    vi.mocked(checkPatch).mockResolvedValue({
      ok: true,
      filesTouched: ["a.ts"],
      dirtyFiles: [],
      diagnostics: "ok"
    });
    vi.mocked(applyPatchTemporary).mockResolvedValue({
      applied: true,
      filesTouched: ["a.ts"],
      diagnostics: "ok"
    });
    vi.mocked(revertPatchTemporary).mockResolvedValue({
      reverted: true,
      filesTouched: ["a.ts"],
      diagnostics: "ok"
    });
    renderPanel();

    await userEvent.click(screen.getByRole("button", { name: /^Check$/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Apply temp$/ }));
    await userEvent.click(await screen.findByRole("button", { name: /^Reject$/ }));

    expect(await screen.findByText("Temporary patch reverted")).toBeInTheDocument();
    expect(screen.getByText("Rejected and temporary patch reverted.")).toBeInTheDocument();
    expect(revertPatchTemporary).toHaveBeenCalledWith(
      "project-1",
      "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new"
    );
  });
});

function makeComparison(): RepairComparison {
  return {
    baselineRunId: "run-before-11111111",
    rerunId: "run-after-22222222",
    generatedAt: "2026-05-01T00:00:00Z",
    verdict: "fixed",
    before: {
      status: "failed",
      summary: {
        total: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        flaky: 0,
        failedTests: [{ testId: "t1", title: "fails", status: "failed", attachments: [] }]
      }
    },
    after: {
      status: "passed",
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        flaky: 0,
        failedTests: []
      }
    },
    delta: { total: 0, passed: 1, failed: -1, skipped: 0, flaky: 0 },
    resolvedFailures: [
      {
        key: "id:t1",
        title: "fails",
        before: { testId: "t1", title: "fails", status: "failed", attachments: [] }
      }
    ],
    remainingFailures: [],
    newFailures: [],
    artifacts: {
      before: {
        runDir: "/runs/before",
        playwrightHtml: "/runs/before/playwright-report",
        allureReportDir: "/runs/before/allure-report",
        qmoSummaryJsonPath: "/runs/before/qmo-summary.json"
      },
      after: {
        runDir: "/runs/after",
        playwrightHtml: "/runs/after/playwright-report",
        allureReportDir: "/runs/after/allure-report",
        qmoSummaryJsonPath: "/runs/after/qmo-summary.json"
      }
    },
    warnings: []
  };
}
