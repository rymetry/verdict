// §1.3 AllureHistoryTrendCard render contract.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AllureHistoryTrendCard } from "@/features/allure-history-trend-card/AllureHistoryTrendCard";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, fetchAllureHistory: vi.fn() };
});
import { fetchAllureHistory } from "@/api/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(fetchAllureHistory).mockReset();
});

function renderCard(projectId: string | null): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AllureHistoryTrendCard projectId={projectId} />
    </QueryClientProvider>
  );
}

describe("AllureHistoryTrendCard", () => {
  it("renders nothing when projectId is null (no project open)", () => {
    const { container } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AllureHistoryTrendCard projectId={null} />
      </QueryClientProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the empty state when entries is an empty array", async () => {
    vi.mocked(fetchAllureHistory).mockResolvedValue({ entries: [], warnings: [] });
    renderCard("p1");
    await waitFor(() => {
      expect(screen.getByTestId("allure-history-trend-card-empty")).toBeInTheDocument();
    });
    expect(screen.getByText(/No history yet/)).toBeInTheDocument();
  });

  it("renders the most recent N entries with pass/total counters", async () => {
    vi.mocked(fetchAllureHistory).mockResolvedValue({
      entries: [
        { generatedAt: "2026-04-30T12:00:00Z", total: 5, passed: 5, failed: 0 },
        { generatedAt: "2026-04-30T12:01:00Z", total: 5, passed: 4, failed: 1 },
        { generatedAt: "2026-04-30T12:02:00Z", total: 5, passed: 5, failed: 0 },
      ],
      warnings: [],
    });
    renderCard("p1");
    await waitFor(() => {
      expect(screen.getByTestId("allure-history-trend-card")).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId("allure-history-trend-row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("4/5 pass");
    expect(rows[1]).toHaveTextContent("1 fail");
  });

  it("only renders the last 5 entries when more are present", async () => {
    vi.mocked(fetchAllureHistory).mockResolvedValue({
      entries: Array.from({ length: 12 }, (_, i) => ({
        generatedAt: `2026-04-30T12:0${i}:00Z`.padEnd("2026-04-30T12:00:00Z".length, "0"),
        total: 5,
        passed: i % 2 === 0 ? 5 : 4,
        failed: i % 2 === 0 ? 0 : 1,
      })),
      warnings: [],
    });
    renderCard("p1");
    await waitFor(() => {
      expect(screen.getAllByTestId("allure-history-trend-row")).toHaveLength(5);
    });
  });

  it("renders an error state when the query fails", async () => {
    vi.mocked(fetchAllureHistory).mockRejectedValue(new Error("boom"));
    renderCard("p1");
    await waitFor(() => {
      expect(screen.getByTestId("allure-history-trend-card-error")).toBeInTheDocument();
    });
  });

  it("surfaces the warning count when some lines were skipped", async () => {
    vi.mocked(fetchAllureHistory).mockResolvedValue({
      entries: [{ generatedAt: "2026-04-30T12:00:00Z", total: 5, passed: 5 }],
      warnings: ["line 2 invalid JSON"],
    });
    renderCard("p1");
    await waitFor(() => {
      expect(screen.getByText(/skipped/)).toBeInTheDocument();
    });
  });
});
