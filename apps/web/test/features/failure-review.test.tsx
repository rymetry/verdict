// FailureReview の振る舞い: null / loading / error / passed / no-failures / failures-list。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { FailureReview } from "@/features/failure-review/FailureReview";
import { makeRunMetadata } from "../_fixtures/run";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, fetchRun: vi.fn() };
});
import { fetchRun } from "@/api/client";

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
  vi.mocked(fetchRun).mockReset();
});

describe("FailureReview", () => {
  it("runId=null のとき empty state 案内文を出す", () => {
    renderWithRunId(null);
    expect(screen.getByText(/Run を開始すると失敗詳細/)).toBeInTheDocument();
    expect(vi.mocked(fetchRun)).not.toHaveBeenCalled();
  });

  it("loading 中は 'Loading run metadata…' を出す", () => {
    vi.mocked(fetchRun).mockReturnValue(new Promise(() => {}));
    renderWithRunId("r1");
    expect(screen.getByText(/Loading run metadata/)).toBeInTheDocument();
  });

  it("error 時は Alert と console.error の両方", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetchRun).mockRejectedValue(new Error("boom"));
    renderWithRunId("r1");
    expect(await screen.findByText("取得失敗")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("passed のとき 'すべて成功' 案内", async () => {
    vi.mocked(fetchRun).mockResolvedValue(
      makeRunMetadata("r1", { status: "passed", summary: undefined })
    );
    renderWithRunId("r1");
    // status passed + summary 無しケース: ガード文言が出る
    // (summary が undefined だと "Run の完了を待機中…" が表示される設計)
    // → status=passed の case を pin する
    expect(await screen.findByText(/全テストが成功しました/)).toBeInTheDocument();
  });

  it("persisted warnings を Run 結果パネルに表示する", async () => {
    vi.mocked(fetchRun).mockResolvedValue(
      makeRunMetadata("r1", {
        status: "passed",
        summary: undefined,
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

  it("summary はあるが failedTests が空のとき '失敗テストはありません' を出す", async () => {
    vi.mocked(fetchRun).mockResolvedValue(
      makeRunMetadata("r1", {
        status: "failed",
        summary: {
          total: 5,
          passed: 5,
          failed: 0,
          skipped: 0,
          flaky: 0,
          failedTests: []
        }
      })
    );
    renderWithRunId("r1");
    expect(await screen.findByText(/失敗テストはありません/)).toBeInTheDocument();
  });

  it("failedTests があるとき各 row + attachments + stack を描画する", async () => {
    vi.mocked(fetchRun).mockResolvedValue(
      makeRunMetadata("r1", {
        status: "failed",
        summary: {
          total: 2,
          passed: 1,
          failed: 1,
          skipped: 0,
          flaky: 0,
          failedTests: [
            {
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
            }
          ]
        }
      })
    );
    renderWithRunId("r1");
    expect(await screen.findByText("checkout > should checkout")).toBeInTheDocument();
    // file:line は failureMeta paragraph と stack details の両方に出るため複数一致を許容する
    expect(screen.getAllByText(/tests\/checkout\.spec\.ts/).length).toBeGreaterThan(0);
    expect(screen.getByText("timeout 5000ms")).toBeInTheDocument();
    expect(screen.getByText("screenshot")).toBeInTheDocument();
    expect(screen.getByText("failure")).toBeInTheDocument();
    expect(screen.getByText("/runs/r1/screenshot.png")).toBeInTheDocument();
  });

  it("status=running + summary 不在のとき '完了を待機中' 案内を出す", async () => {
    // 4 つ目の三項分岐 (failedTests 無し / passed でない / summary 無し) を pin。
    // 分岐順序を入れ替えると "完了を待機中…" が誤表示になるため文言をピン留めする。
    vi.mocked(fetchRun).mockResolvedValue(
      makeRunMetadata("r1", { status: "running", summary: undefined })
    );
    renderWithRunId("r1");
    expect(await screen.findByText(/Run の完了を待機中/)).toBeInTheDocument();
  });

  it("Header の '<n> failed' badge を表示する", async () => {
    vi.mocked(fetchRun).mockResolvedValue(
      makeRunMetadata("r1", {
        status: "failed",
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          flaky: 0,
          failedTests: [
            {
              title: "x",
              status: "failed",
              attachments: []
            }
          ]
        }
      })
    );
    renderWithRunId("r1");
    expect(await screen.findByText("1 failed")).toBeInTheDocument();
  });
});
