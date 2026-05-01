// RunConsole の表示と subscribe/unsubscribe ライフサイクル。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import * as React from "react";

import type { EventStream, EventListener, WsConnectionState } from "@/api/events";
import { WorkbenchApiError, cancelRun } from "@/api/client";
import { RunConsole } from "@/features/run-console/RunConsole";

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    cancelRun: vi.fn()
  };
});

afterEach(() => {
  cleanup();
  vi.mocked(cancelRun).mockReset();
});

interface FakeStream extends EventStream {
  emit(event: Parameters<EventListener>[0]): void;
}

function makeFakeStream(): FakeStream {
  let listeners: EventListener[] = [];
  let state: WsConnectionState = "open";
  return {
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((l) => l !== listener);
      };
    },
    subscribeState(listener) {
      listener(state);
      return () => {};
    },
    getState: () => state,
    close() {
      state = "disconnected";
    },
    emit(event) {
      for (const l of listeners) l(event);
    }
  };
}

describe("RunConsole", () => {
  it("activeRunId=null のとき idle 表示", () => {
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId={null} />);
    expect(screen.getByText(/Idle —/)).toBeInTheDocument();
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("stdout/stderr パネルはデザイントークン由来の配色を使う", async () => {
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId="r1" />);
    const stdout = screen.getByLabelText("標準出力");
    expect(stdout.className).toContain("bg-[var(--bg-0)]");
    expect(stdout.className).toContain("text-[var(--ink-1)]");
    expect(stdout.className).not.toMatch(/#(?:[0-9a-fA-F]{3,8})/);

    await act(async () => {
      stream.emit({
        type: "run.stderr",
        runId: "r1",
        sequence: 1,
        timestamp: "2026-04-28T00:00:00Z",
        payload: { chunk: "warn:something\n" }
      });
    });
    const stderr = screen.getByLabelText("標準エラー");
    expect(stderr.className).toContain("bg-[var(--fail-soft)]");
    expect(stderr.className).toContain("text-[var(--fail)]");
    expect(stderr.className).not.toMatch(/#(?:[0-9a-fA-F]{3,8})/);
  });

  it("activeRunId が設定されると subscribe が呼ばれ、stdout が反映される", async () => {
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId="r1" />);
    await act(async () => {
      stream.emit({
        type: "run.stdout",
        runId: "r1",
        sequence: 1,
        timestamp: "2026-04-28T00:00:00Z",
        payload: { chunk: "hello\n" }
      });
    });
    expect(screen.getByLabelText("標準出力").textContent).toContain("hello");
  });

  it("別 runId の event は無視される", async () => {
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId="r1" />);
    await act(async () => {
      stream.emit({
        type: "run.stdout",
        runId: "other",
        sequence: 1,
        timestamp: "2026-04-28T00:00:00Z",
        payload: { chunk: "should not appear\n" }
      });
    });
    expect(screen.getByLabelText("標準出力").textContent).not.toContain("should not appear");
  });

  it("run.completed (passed) で badge と summary が更新される", async () => {
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId="r1" />);
    await act(async () => {
      stream.emit({
        type: "run.completed",
        runId: "r1",
        sequence: 2,
        timestamp: "2026-04-28T00:00:00Z",
        // RunCompletedPayloadSchema: durationMs (mandatory) + summary は failedTests を含む
        payload: {
          status: "passed",
          exitCode: 0,
          durationMs: 12000,
          warnings: [],
          summary: {
            total: 3,
            passed: 3,
            failed: 0,
            skipped: 0,
            flaky: 0,
            failedTests: []
          }
        }
      });
    });
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText(/3 passed · 0 failed/)).toBeInTheDocument();
  });

  it("run.completed の trace/screenshot/video attachments を launch link として表示する", async () => {
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId="r1" />);
    await act(async () => {
      stream.emit({
        type: "run.completed",
        runId: "r1",
        sequence: 2,
        timestamp: "2026-04-28T00:00:00Z",
        payload: {
          status: "failed",
          exitCode: 1,
          durationMs: 12000,
          warnings: [],
          summary: {
            total: 1,
            passed: 0,
            failed: 1,
            skipped: 0,
            flaky: 0,
            failedTests: [
              {
                title: "checkout fails",
                status: "failed",
                attachments: [
                  { kind: "screenshot", label: "screenshot", path: "/p/test-results/a.png" },
                  { kind: "trace", label: "trace", path: "/p/test-results/trace.zip" },
                  { kind: "video", label: "video", path: "/p/test-results/video.webm" },
                  { kind: "log", label: "stdout", path: "/p/stdout.log" }
                ]
              }
            ]
          }
        }
      });
    });

    const links = screen.getByLabelText("Evidence artifact links");
    expect(links).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "screenshot: screenshot" })).toHaveAttribute(
      "href",
      "/api/runs/r1/evidence/0/0"
    );
    expect(screen.getByRole("link", { name: "trace: trace" })).toHaveAttribute(
      "href",
      "/api/runs/r1/evidence/0/1"
    );
    expect(screen.getByRole("link", { name: "video: video" })).toHaveAttribute(
      "href",
      "/api/runs/r1/evidence/0/2"
    );
    expect(screen.queryByRole("link", { name: "log: stdout" })).not.toBeInTheDocument();
  });

  it("run.completed の warnings を warning alert として表示する", async () => {
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId="r1" />);
    await act(async () => {
      stream.emit({
        type: "run.completed",
        runId: "r1",
        sequence: 2,
        timestamp: "2026-04-28T00:00:00Z",
        payload: {
          status: "passed",
          exitCode: 0,
          durationMs: 12000,
          warnings: [
            "stdout log write failed; websocket stream was still delivered. code=ENOSPC; failures=1"
          ],
          summary: {
            total: 1,
            passed: 1,
            failed: 0,
            skipped: 0,
            flaky: 0,
            failedTests: []
          }
        }
      });
    });
    expect(screen.getByText("Run warnings")).toBeInTheDocument();
    expect(screen.getByText(/stdout log write failed/)).toBeInTheDocument();
  });

  it("run.cancelled は Cancelled badge を出す", async () => {
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId="r1" />);
    await act(async () => {
      stream.emit({
        type: "run.cancelled",
        runId: "r1",
        sequence: 3,
        timestamp: "2026-04-28T00:00:00Z",
        payload: {
          status: "cancelled",
          cancelReason: "user-request",
          exitCode: null,
          durationMs: 0,
          warnings: []
        }
      });
    });
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Cancelled by user request")).toBeInTheDocument();
  });

  it("running run の Cancel 404 race は benign hint として扱う", async () => {
    vi.mocked(cancelRun).mockRejectedValue(
      new WorkbenchApiError("Run r1 is not currently active.", "NOT_ACTIVE", 404)
    );
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId="r1" />);

    await act(async () => {
      stream.emit({
        type: "run.started",
        runId: "r1",
        sequence: 1,
        timestamp: "2026-04-28T00:00:00Z",
        payload: {
          command: { executable: "pnpm", args: ["test"] },
          cwd: "/repo",
          startedAt: "2026-04-28T00:00:00Z"
        }
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel run r1" }));

    await waitFor(() => {
      expect(screen.getByText("Run already finished.")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Cancel request failed/)).not.toBeInTheDocument();
  });

  it("run.cancelled with internal reason shows 'Cancelled by workbench'", async () => {
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId="r1" />);
    await act(async () => {
      stream.emit({
        type: "run.cancelled",
        runId: "r1",
        sequence: 2,
        timestamp: "2026-04-28T00:00:00Z",
        payload: {
          status: "cancelled",
          cancelReason: "internal",
          exitCode: null,
          durationMs: 0,
          warnings: []
        }
      });
    });
    expect(screen.getByText("Cancelled by workbench")).toBeInTheDocument();
  });

  it("run.cancelled の warnings を表示する", async () => {
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId="r1" />);
    await act(async () => {
      stream.emit({
        type: "run.cancelled",
        runId: "r1",
        sequence: 3,
        timestamp: "2026-04-28T00:00:00Z",
        payload: {
          status: "cancelled",
          cancelReason: "internal",
          exitCode: null,
          durationMs: 0,
          warnings: ["Run was cancelled after timeout warning. code=TIMEOUT"]
        }
      });
    });

    expect(screen.getByText("Run warnings")).toBeInTheDocument();
    expect(screen.getByText(/cancelled after timeout warning/)).toBeInTheDocument();
  });

  it("run.error は Error badge と warnings を表示する", async () => {
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId="r1" />);
    await act(async () => {
      stream.emit({
        type: "run.error",
        runId: "r1",
        sequence: 3,
        timestamp: "2026-04-28T00:00:00Z",
        payload: {
          message: "internal message should not render",
          status: "error",
          exitCode: null,
          durationMs: 0,
          warnings: ["Safe user-facing warning. code=UNKNOWN"]
        }
      });
    });

    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Run warnings")).toBeInTheDocument();
    expect(screen.getByText(/Safe user-facing warning/)).toBeInTheDocument();
    expect(screen.queryByText(/internal message should not render/)).not.toBeInTheDocument();
  });

  it("stderr が出ると details が描画される", async () => {
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId="r1" />);
    await act(async () => {
      stream.emit({
        type: "run.stderr",
        runId: "r1",
        sequence: 1,
        timestamp: "2026-04-28T00:00:00Z",
        payload: { chunk: "warn:something\n" }
      });
    });
    expect(screen.getByText("stderr")).toBeInTheDocument();
  });

  it("activeRunId 切替えで stdout が空にリセットされる", async () => {
    const stream = makeFakeStream();
    const { rerender } = render(<RunConsole eventStream={stream} activeRunId="r1" />);
    await act(async () => {
      stream.emit({
        type: "run.stdout",
        runId: "r1",
        sequence: 1,
        timestamp: "2026-04-28T00:00:00Z",
        payload: { chunk: "old run output\n" }
      });
    });
    expect(screen.getByLabelText("標準出力").textContent).toContain("old run output");

    rerender(<RunConsole eventStream={stream} activeRunId="r2" />);
    expect(screen.getByLabelText("標準出力").textContent ?? "").not.toContain("old run output");
  });

  it("payload schema 不一致は console.error して state を変えない", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stream = makeFakeStream();
    render(<RunConsole eventStream={stream} activeRunId="r1" />);
    await act(async () => {
      stream.emit({
        type: "run.stdout",
        runId: "r1",
        sequence: 1,
        timestamp: "2026-04-28T00:00:00Z",
        payload: { wrong: "shape" } as never
      });
    });
    expect(consoleSpy).toHaveBeenCalledWith(
      "[RunConsole] run.stdout payload schema mismatch",
      expect.anything()
    );
    expect(screen.getByLabelText("標準出力").textContent ?? "").toBe("");
  });
});
