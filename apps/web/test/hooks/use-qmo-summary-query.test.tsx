import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QmoSummary } from "@pwqa/shared";

import { useQmoSummaryQuery } from "@/hooks/use-qmo-summary-query";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    fetchQmoSummary: vi.fn()
  };
});

import { fetchQmoSummary } from "@/api/client";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function makeSummary(): QmoSummary {
  return {
    runId: "run-1",
    projectId: "p1",
    generatedAt: "2026-04-30T12:00:00.000Z",
    outcome: "ready",
    warnings: [],
    reportLinks: {}
  };
}

describe("useQmoSummaryQuery", () => {
  beforeEach(() => {
    vi.mocked(fetchQmoSummary).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("polls while the summary is not generated and stops after 200 data", async () => {
    const summary = makeSummary();
    vi.mocked(fetchQmoSummary)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(summary);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useQmoSummaryQuery("run-1"), {
      wrapper: wrapper(client)
    });

    await waitFor(() => expect(result.current.data).toBeNull());
    expect(fetchQmoSummary).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(result.current.data).toEqual(summary), { timeout: 2_500 });
    expect(fetchQmoSummary).toHaveBeenCalledTimes(2);

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(fetchQmoSummary).toHaveBeenCalledTimes(2);
  }, 5_000);
});
