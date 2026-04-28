import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyEvent,
  initialRunConsoleState
} from "../src/features/run-console/RunConsole";
import type { WorkbenchEvent } from "@pwqa/shared";

function evt(partial: Partial<WorkbenchEvent>): WorkbenchEvent {
  return {
    type: "run.queued",
    sequence: 1,
    timestamp: new Date().toISOString(),
    runId: "run-1",
    payload: {},
    ...partial
  } as WorkbenchEvent;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RunConsole applyEvent", () => {
  it("transitions to running on run.queued", () => {
    const next = applyEvent(initialRunConsoleState, evt({ type: "run.queued" }));
    expect(next.status).toBe("running");
  });

  it("appends stdout chunk via run.stdout payload", () => {
    const next = applyEvent(
      initialRunConsoleState,
      evt({ type: "run.stdout", payload: { chunk: "hello" } })
    );
    expect(next.stdout).toEqual(["hello"]);
  });

  it("malformed payload は console.error して state を維持する", () => {
    // δ R1: silent drop は破棄。schema 不一致は本番でも痕跡を残す invariant を pin。
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const next = applyEvent(
      initialRunConsoleState,
      evt({ type: "run.stdout", payload: { not_chunk: 42 } })
    );
    expect(next.stdout).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[RunConsole] run.stdout payload schema mismatch",
      expect.anything()
    );
  });

  it("captures summary from run.completed payload", () => {
    const next = applyEvent(
      initialRunConsoleState,
      evt({
        type: "run.completed",
        payload: {
          exitCode: 0,
          status: "passed",
          durationMs: 1234,
          warnings: ["summary unavailable"],
          summary: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, failedTests: [] }
        }
      })
    );
    expect(next.status).toBe("passed");
    expect(next.exitCode).toBe(0);
    expect(next.durationMs).toBe(1234);
    expect(next.summary?.passed).toBe(1);
    expect(next.warnings).toEqual(["summary unavailable"]);
  });

  it("treats run.cancelled as cancelled status regardless of payload", () => {
    const next = applyEvent(
      initialRunConsoleState,
      evt({ type: "run.cancelled", payload: {} })
    );
    expect(next.status).toBe("cancelled");
  });

  it("MAX_LINES (1000) 到達後は先頭が drop され末尾が保たれる", () => {
    // メモリリーク防衛の boundary 検証。1000 件 push 後にもう 1 件入れると、
    // stdout[0] が "1" ではなく "2" になり、長さは 1000 で固定される。
    let state = initialRunConsoleState;
    for (let i = 1; i <= 1000; i++) {
      state = applyEvent(state, evt({ type: "run.stdout", payload: { chunk: String(i) } }));
    }
    expect(state.stdout).toHaveLength(1000);
    expect(state.stdout[0]).toBe("1");
    expect(state.stdout[999]).toBe("1000");

    state = applyEvent(state, evt({ type: "run.stdout", payload: { chunk: "1001" } }));
    expect(state.stdout).toHaveLength(1000);
    expect(state.stdout[0]).toBe("2");
    expect(state.stdout[999]).toBe("1001");
  });

  it("run.completed (failed) は failed status に遷移する", () => {
    const next = applyEvent(
      initialRunConsoleState,
      evt({
        type: "run.completed",
        payload: {
          exitCode: 1,
          status: "failed",
          durationMs: 555,
          warnings: ["stdout log write failed; websocket stream was still delivered. code=ENOSPC; failures=1"],
          summary: { total: 2, passed: 0, failed: 2, skipped: 0, flaky: 0, failedTests: [] }
        }
      })
    );
    expect(next.status).toBe("failed");
    expect(next.exitCode).toBe(1);
    expect(next.summary?.failed).toBe(2);
    expect(next.warnings.join("\n")).toContain("stdout log write failed");
  });

  it("run.error は payload に関わらず error status に遷移する", () => {
    const next = applyEvent(
      initialRunConsoleState,
      evt({
        type: "run.error",
        payload: {
          exitCode: 137,
          status: "error",
          durationMs: 0,
          warnings: [],
          message: "Runner failed after spawn."
        }
      })
    );
    expect(next.status).toBe("error");
    expect(next.exitCode).toBe(137);
  });

  it("snapshot event は no-op (state 不変) で console.warn しない", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = { ...initialRunConsoleState, stdout: ["a", "b"] };
    const next = applyEvent(before, evt({ type: "snapshot", payload: {} }));
    expect(next).toEqual(before);
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
