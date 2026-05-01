// FailureReview の振る舞い: null / loading / error / passed / no-failures / failures-list。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FailureReviewResponse } from "@pwqa/shared";

import { FailureReview } from "@/features/failure-review/FailureReview";
import { makeRunMetadata } from "../_fixtures/run";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, fetchFailureReview: vi.fn() };
});
import { fetchFailureReview } from "@/api/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWithRunId(runId: string | null): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <FailureReview runId={runId} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.mocked(fetchFailureReview).mockReset();
});

describe("FailureReview", () => {
  it("runId=null のとき empty state 案内文を出す", () => {
    renderWithRunId(null);
    expect(screen.getByText(/Run を開始すると失敗詳細/)).toBeInTheDocument();
    expect(vi.mocked(fetchFailureReview)).not.toHaveBeenCalled();
  });

  it("loading 中は 'Loading run metadata…' を出す", () => {
    vi.mocked(fetchFailureReview).mockReturnValue(new Promise(() => {}));
    renderWithRunId("r1");
    expect(screen.getByText(/Loading run metadata/)).toBeInTheDocument();
  });

  it("error 時は Alert と console.error の両方", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetchFailureReview).mockRejectedValue(new Error("boom"));
    renderWithRunId("r1");
    expect(await screen.findByText("取得失敗")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("passed のとき 'すべて成功' 案内", async () => {
    vi.mocked(fetchFailureReview).mockResolvedValue(makeFailureReview("r1", { status: "passed" }));
    renderWithRunId("r1");
    expect(await screen.findByText(/全テストが成功しました/)).toBeInTheDocument();
  });

  it("persisted warnings を Run 結果パネルに表示する", async () => {
    vi.mocked(fetchFailureReview).mockResolvedValue(
      makeFailureReview("r1", {
        status: "passed",
        warnings: [
          "Playwright JSON redaction failed; raw result artifact may still contain secrets. redactionCode=EACCES; removalCode=ENOENT"
        ]
      })
    );
    renderWithRunId("r1");
    expect(await screen.findByText("Run warnings")).toBeInTheDocument();
    expect(screen.getByText(/Playwright JSON redaction failed/)).toBeInTheDocument();
    expect(screen.getByText(/全テストが成功しました/)).toBeInTheDocument();
  });

  it("failedTests が空のとき '失敗テストはありません' を出す", async () => {
    vi.mocked(fetchFailureReview).mockResolvedValue(makeFailureReview("r1", { status: "failed" }));
    renderWithRunId("r1");
    expect(await screen.findByText(/失敗テストはありません/)).toBeInTheDocument();
  });

  it("failedTests があるとき各 row + artifacts + stack + Phase 2 signals を描画する", async () => {
    vi.mocked(fetchFailureReview).mockResolvedValue(
      makeFailureReview("r1", {
        status: "failed",
        failedTests: [
          {
            test: {
              testId: "t1",
              title: "should checkout",
              fullTitle: "checkout > should checkout",
              filePath: "tests/checkout.spec.ts",
              line: 87,
              status: "failed",
              durationMs: 18700,
              message: "timeout 5000ms",
              stack: "at tests/checkout.spec.ts:87:36",
              attachments: [
                {
                  kind: "screenshot",
                  label: "failure",
                  path: "/runs/r1/screenshot.png"
                }
              ]
            },
            history: [
              { generatedAt: "2026-04-30T00:00:00Z", status: "passed" },
              { generatedAt: "2026-04-30T00:10:00Z", status: "failed" }
            ],
            knownIssues: [
              {
                id: "ki-1",
                title: "Checkout timeout is tracked",
                status: "open"
              }
            ],
            flaky: {
              isCandidate: true,
              passedRuns: 1,
              failedRuns: 1,
              brokenRuns: 0,
              skippedRuns: 0,
              recentStatuses: ["passed", "failed"]
            }
          }
        ]
      })
    );
    renderWithRunId("r1");
    expect(await screen.findByText("checkout > should checkout")).toBeInTheDocument();
    expect(screen.getAllByText(/tests\/checkout\.spec\.ts/).length).toBeGreaterThan(0);
    expect(screen.getByText("timeout 5000ms")).toBeInTheDocument();
    expect(screen.getByText("screenshot")).toBeInTheDocument();
    expect(screen.getByText("failure")).toBeInTheDocument();
    expect(screen.getByText("/runs/r1/screenshot.png")).toBeInTheDocument();
    expect(screen.getByText("Allure history")).toBeInTheDocument();
    expect(screen.getByText("Checkout timeout is tracked")).toBeInTheDocument();
    expect(screen.getByText("flaky candidate")).toBeInTheDocument();
  });

  it("history / known issue がないとき Phase 2 の空状態を表示する", async () => {
    vi.mocked(fetchFailureReview).mockResolvedValue(
      makeFailureReview("r1", {
        status: "failed",
        failedTests: [
          {
            test: {
              testId: "t1",
              title: "x",
              status: "failed",
              attachments: []
            },
            history: [],
            knownIssues: [],
            flaky: {
              isCandidate: false,
              passedRuns: 0,
              failedRuns: 0,
              brokenRuns: 0,
              skippedRuns: 0,
              recentStatuses: []
            }
          }
        ]
      })
    );
    renderWithRunId("r1");
    expect(await screen.findByText("No per-test history")).toBeInTheDocument();
    expect(screen.getByText("No known issue match")).toBeInTheDocument();
    expect(screen.getByText("No history signal")).toBeInTheDocument();
  });

  it("status=running のとき '完了を待機中' 案内を出す", async () => {
    vi.mocked(fetchFailureReview).mockResolvedValue(makeFailureReview("r1", { status: "running" }));
    renderWithRunId("r1");
    expect(await screen.findByText(/Run の完了を待機中/)).toBeInTheDocument();
  });

  it("Header の '<n> failed' badge を表示する", async () => {
    vi.mocked(fetchFailureReview).mockResolvedValue(
      makeFailureReview("r1", {
        status: "failed",
        failedTests: [
          {
            test: {
              title: "x",
              status: "failed",
              attachments: []
            },
            history: [],
            knownIssues: [],
            flaky: {
              isCandidate: false,
              passedRuns: 0,
              failedRuns: 0,
              brokenRuns: 0,
              skippedRuns: 0,
              recentStatuses: []
            }
          }
        ]
      })
    );
    renderWithRunId("r1");
    expect(await screen.findByText("1 failed")).toBeInTheDocument();
  });
});

function makeFailureReview(
  runId: string,
  overrides: Partial<FailureReviewResponse> = {}
): FailureReviewResponse {
  const run = makeRunMetadata(runId);
  return {
    runId,
    projectId: run.projectId,
    status: run.status,
    completedAt: run.completedAt,
    failedTests: [],
    warnings: [],
    ...overrides
  };
}
