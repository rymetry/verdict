// RunConsole の表示と subscribe/unsubscribe ライフサイクル。
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import * as React from "react";

import type { EventStream, EventListener, WsConnectionState } from "@/api/events";
import { RunConsole } from "@/features/run-console/RunConsole";

afterEach(() => {
  cleanup();
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
        // applyEvent は run.cancelled の場合 payload schema 一致しなくても "cancelled" を返す。
        // 安全のため durationMs を nonnegative integer で渡す。
        payload: {
          status: "cancelled",
          exitCode: null,
          durationMs: 0,
          warnings: []
        }
      });
    });
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
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
