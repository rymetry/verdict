// §1.2 useInsightsSummary derivation contract.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    fetchCurrentProject: vi.fn(),
    fetchRuns: vi.fn(),
    fetchQmoSummary: vi.fn(),
    fetchAllureHistory: vi.fn(),
  };
});
import {
  fetchAllureHistory,
  fetchCurrentProject,
  fetchQmoSummary,
  fetchRuns,
} from "@/api/client";

import { useInsightsSummary } from "@/hooks/use-insights-summary";

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(fetchCurrentProject).mockReset();
  vi.mocked(fetchRuns).mockReset();
  vi.mocked(fetchQmoSummary).mockReset();
  vi.mocked(fetchAllureHistory).mockReset();
});

function wrapper(): {
  client: QueryClient;
  Wrapper: React.ComponentType<{ children: React.ReactNode }>;
} {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, Wrapper };
}

function fakeProject(id = "p1"): {
  id: string;
  rootPath: string;
  packageManager: {
    name: "pnpm";
    status: "ok";
    confidence: "high";
    reason: string;
    warnings: string[];
    errors: string[];
    lockfiles: string[];
    commandTemplates: { playwrightTest: { executable: string; args: string[] } };
    hasPlaywrightDevDependency: boolean;
    localBinaryUsable: boolean;
    blockingExecution: boolean;
  };
  hasAllurePlaywright: boolean;
  hasAllureCli: boolean;
  warnings: string[];
  blockingExecution: boolean;
} {
  return {
    id,
    rootPath: id,
    packageManager: {
      name: "pnpm",
      status: "ok",
      confidence: "high",
      reason: "fixture",
      warnings: [],
      errors: [],
      lockfiles: ["pnpm-lock.yaml"],
      commandTemplates: {
        playwrightTest: { executable: "pnpm", args: ["exec", "playwright", "test"] },
      },
      hasPlaywrightDevDependency: true,
      localBinaryUsable: true,
      blockingExecution: false,
    },
    hasAllurePlaywright: false,
    hasAllureCli: false,
    warnings: [],
    blockingExecution: false,
  };
}

describe("useInsightsSummary", () => {
  it("returns null summary when there is no QMO data and no history", async () => {
    vi.mocked(fetchCurrentProject).mockResolvedValue(fakeProject() as never);
    vi.mocked(fetchRuns).mockResolvedValue({ runs: [] });
    vi.mocked(fetchAllureHistory).mockResolvedValue({ entries: [], warnings: [] });

    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useInsightsSummary(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.summary).toBeNull();
  });

  it("derives stats and readiness from a QMO summary alone", async () => {
    vi.mocked(fetchCurrentProject).mockResolvedValue(fakeProject() as never);
    vi.mocked(fetchRuns).mockResolvedValue({
      runs: [
        {
          runId: "run-1",
          projectId: "p1",
          status: "passed",
          startedAt: "2026-04-30T12:00:00Z",
          warnings: [],
        },
      ],
    });
    vi.mocked(fetchQmoSummary).mockResolvedValue({
      runId: "run-1",
      projectId: "p1",
      generatedAt: "2026-04-30T12:00:00Z",
      outcome: "ready",
      testSummary: {
        total: 5,
        passed: 5,
        failed: 0,
        skipped: 0,
        flaky: 0,
        failedTests: [],
      },
      qualityGate: undefined,
      warnings: [],
      reportLinks: {},
      runDurationMs: 60000,
      command: { executable: "pnpm", args: [] },
    });
    vi.mocked(fetchAllureHistory).mockResolvedValue({ entries: [], warnings: [] });

    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useInsightsSummary(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.summary).not.toBeNull();
    });
    const summary = result.current.summary!;
    expect(summary.readiness.verdict).toBe("ready");
    expect(summary.readiness.score).toBe(100);
    expect(summary.stats).toEqual([
      { label: "Total", value: "5" },
      { label: "Passed", value: "5" },
      { label: "Failed", value: "0" },
      { label: "Flaky", value: "0" },
      { label: "Skipped", value: "0" },
    ]);
    expect(summary.criticalFailures).toEqual([]);
    expect(summary.qualityGateStatus).toBe("not-evaluated");
    expect(summary.allureSummary).toEqual([]);
  });

  it("derives qualityGateStatus from QMO qualityGate", async () => {
    vi.mocked(fetchCurrentProject).mockResolvedValue(fakeProject() as never);
    vi.mocked(fetchRuns).mockResolvedValue({
      runs: [
        {
          runId: "run-qg",
          projectId: "p1",
          status: "failed",
          startedAt: "2026-04-30T12:00:00Z",
          warnings: [],
        },
      ],
    });
    vi.mocked(fetchQmoSummary).mockResolvedValue({
      runId: "run-qg",
      projectId: "p1",
      generatedAt: "2026-04-30T12:00:00Z",
      outcome: "not-ready",
      qualityGate: {
        status: "failed",
        profile: "release-smoke",
        exitCode: 1,
        warnings: [],
      },
      warnings: [],
      reportLinks: {},
      command: { executable: "pnpm", args: [] },
    });
    vi.mocked(fetchAllureHistory).mockResolvedValue({ entries: [], warnings: [] });

    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useInsightsSummary(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.summary?.qualityGateStatus).toBe("failed");
    });
  });

  it("populates AllureSummary rows from history when present", async () => {
    vi.mocked(fetchCurrentProject).mockResolvedValue(fakeProject() as never);
    vi.mocked(fetchRuns).mockResolvedValue({ runs: [] });
    vi.mocked(fetchAllureHistory).mockResolvedValue({
      entries: [
        { generatedAt: "2026-04-30T12:00:00Z", total: 5, passed: 4, failed: 1 },
        { generatedAt: "2026-04-30T12:01:00Z", total: 5, passed: 5, failed: 0 },
      ],
      warnings: [],
    });

    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useInsightsSummary(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.summary).not.toBeNull();
    });
    const summary = result.current.summary!;
    // No QMO → readiness derived from latest history entry (0 failures = ready).
    expect(summary.readiness.verdict).toBe("ready");
    expect(summary.allureSummary[0]?.actual).toBe("100.0%");
    expect(summary.allureSummary[0]?.previous).toBe("80.0%");
  });

  it("caps criticalFailures to 5 entries (top-N display)", async () => {
    vi.mocked(fetchCurrentProject).mockResolvedValue(fakeProject() as never);
    vi.mocked(fetchRuns).mockResolvedValue({
      runs: [
        {
          runId: "run-1",
          projectId: "p1",
          status: "failed",
          startedAt: "2026-04-30T12:00:00Z",
          warnings: [],
        },
      ],
    });
    vi.mocked(fetchQmoSummary).mockResolvedValue({
      runId: "run-1",
      projectId: "p1",
      generatedAt: "2026-04-30T12:00:00Z",
      outcome: "not-ready",
      testSummary: {
        total: 12,
        passed: 5,
        failed: 7,
        skipped: 0,
        flaky: 0,
        failedTests: Array.from({ length: 7 }, (_, i) => ({
          title: `failure ${i + 1}`,
          fullTitle: `suite > failure ${i + 1}`,
          status: "failed",
          attachments: [],
        })),
      },
      warnings: [],
      reportLinks: {},
      command: { executable: "pnpm", args: [] },
    });
    vi.mocked(fetchAllureHistory).mockResolvedValue({ entries: [], warnings: [] });

    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useInsightsSummary(), { wrapper: Wrapper });
    await waitFor(() => {
      expect(result.current.summary?.criticalFailures.length).toBe(5);
    });
    expect(result.current.summary?.readiness.verdict).toBe("not-ready");
  });
});
