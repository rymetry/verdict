import { describe, expect, it } from "vitest";
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

  it("ignores malformed payload (defends against version skew)", () => {
    const next = applyEvent(
      initialRunConsoleState,
      evt({ type: "run.stdout", payload: { not_chunk: 42 } })
    );
    expect(next.stdout).toEqual([]);
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
          summary: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, failedTests: [] }
        }
      })
    );
    expect(next.status).toBe("passed");
    expect(next.exitCode).toBe(0);
    expect(next.durationMs).toBe(1234);
    expect(next.summary?.passed).toBe(1);
  });

  it("treats run.cancelled as cancelled status regardless of payload", () => {
    const next = applyEvent(
      initialRunConsoleState,
      evt({ type: "run.cancelled", payload: {} })
    );
    expect(next.status).toBe("cancelled");
  });
});
