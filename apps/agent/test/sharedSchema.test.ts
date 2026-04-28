import { describe, expect, it } from "vitest";
import {
  RunCompletedPayloadSchema,
  RunCancelledPayloadSchema,
  RunErrorPayloadSchema,
  RunListItemSchema,
  RunQueuedPayloadSchema,
  RunStartedPayloadSchema,
  SnapshotPayloadSchema,
  WorkbenchEventSchema,
  terminalStatusMatchesEvent
} from "@pwqa/shared";

describe("shared run warning schemas", () => {
  it("preserves warnings in terminal payloads and run list items", () => {
    const warnings = [
      "stdout log write failed; websocket stream was still delivered. code=ENOSPC; failures=1"
    ];

    expect(
      RunCompletedPayloadSchema.parse({
        exitCode: 0,
        signal: null,
        status: "passed",
        durationMs: 123,
        warnings
      }).warnings
    ).toEqual(warnings);

    expect(
      RunCancelledPayloadSchema.parse({
        exitCode: null,
        signal: "SIGTERM",
        status: "cancelled",
        durationMs: 123,
        warnings
      }).warnings
    ).toEqual(warnings);

    expect(
      RunErrorPayloadSchema.parse({
        message: "Runner failed after spawn.",
        exitCode: null,
        signal: null,
        status: "error",
        durationMs: 123,
        warnings
      }).warnings
    ).toEqual(warnings);

    expect(
      RunListItemSchema.parse({
        runId: "r1",
        projectId: "p1",
        status: "passed",
        startedAt: "2026-04-28T00:00:00Z",
        completedAt: "2026-04-28T00:00:01Z",
        durationMs: 123,
        exitCode: 0,
        warnings
      }).warnings
    ).toEqual(warnings);
  });

  it("defaults omitted warnings to [] for backward-compatible event parsing", () => {
    expect(
      RunCompletedPayloadSchema.parse({
        exitCode: 0,
        signal: null,
        status: "passed",
        durationMs: 123
      }).warnings
    ).toEqual([]);

    expect(
      RunErrorPayloadSchema.parse({
        message: "Runner failed after spawn.",
        exitCode: null,
        signal: null,
        status: "error",
        durationMs: 123
      }).warnings
    ).toEqual([]);
  });

  it("requires run.error payloads to include a safe message", () => {
    expect(() =>
      RunErrorPayloadSchema.parse({
        exitCode: null,
        signal: null,
        status: "error",
        durationMs: 123
      })
    ).toThrow();
  });

  it("does not allow success or failure statuses in run.error payloads", () => {
    expect(() =>
      RunErrorPayloadSchema.parse({
        message: "invalid",
        exitCode: 0,
        signal: null,
        status: "passed",
        durationMs: 123,
        warnings: []
      })
    ).toThrow();
  });

  it("does not allow terminal event statuses to cross schema boundaries", () => {
    expect(() =>
      RunCompletedPayloadSchema.parse({
        exitCode: null,
        signal: null,
        status: "error",
        durationMs: 123,
        warnings: []
      })
    ).toThrow();

    expect(() =>
      RunCancelledPayloadSchema.parse({
        exitCode: 0,
        signal: null,
        status: "passed",
        durationMs: 123,
        warnings: []
      })
    ).toThrow();
  });

  it("round-trips non-terminal event payload schemas", () => {
    expect(
      RunQueuedPayloadSchema.parse({
        request: { projectId: "project-1", headed: false }
      })
    ).toEqual({ request: { projectId: "project-1", headed: false } });

    expect(
      RunStartedPayloadSchema.parse({
        command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
        cwd: "/tmp/project",
        startedAt: "2026-04-28T00:00:00.000Z"
      })
    ).toEqual({
      command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
      cwd: "/tmp/project",
      startedAt: "2026-04-28T00:00:00.000Z"
    });

    expect(
      SnapshotPayloadSchema.parse({
        service: "playwright-workbench-agent",
        version: "0.1.0"
      })
    ).toEqual({
      service: "playwright-workbench-agent",
      version: "0.1.0"
    });
  });

  it("validates run.started cwd and timestamp strictly", () => {
    expect(() =>
      RunStartedPayloadSchema.parse({
        command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
        cwd: "relative/project",
        startedAt: "2026-04-28T00:00:00.000Z"
      })
    ).toThrow(/absolute path/);

    expect(() =>
      RunStartedPayloadSchema.parse({
        command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
        cwd: "/tmp/project",
        startedAt: "not-a-date"
      })
    ).toThrow();
  });

  it("accepts only structured cancellation reasons", () => {
    expect(
      RunCancelledPayloadSchema.parse({
        exitCode: null,
        signal: "SIGTERM",
        status: "cancelled",
        cancelReason: "user-request",
        durationMs: 123,
        warnings: []
      }).cancelReason
    ).toBe("user-request");

    expect(() =>
      RunCancelledPayloadSchema.parse({
        exitCode: null,
        signal: "SIGTERM",
        status: "cancelled",
        cancelReason: "/private/raw reason",
        durationMs: 123,
        warnings: []
      })
    ).toThrow();
  });

  it("keeps terminal event and status mapping in shared code", () => {
    expect(terminalStatusMatchesEvent("run.completed", "passed")).toBe(true);
    expect(terminalStatusMatchesEvent("run.completed", "failed")).toBe(true);
    expect(terminalStatusMatchesEvent("run.completed", "error")).toBe(false);
    expect(terminalStatusMatchesEvent("run.cancelled", "cancelled")).toBe(true);
    expect(terminalStatusMatchesEvent("run.error", "error")).toBe(true);
  });

  it("rejects mismatched event type and payload combinations at the envelope boundary", () => {
    expect(() =>
      WorkbenchEventSchema.parse({
        type: "run.completed",
        sequence: 1,
        timestamp: "2026-04-28T00:00:00.000Z",
        runId: "run-1",
        payload: {
          message: "invalid combination",
          exitCode: null,
          signal: null,
          status: "error",
          durationMs: 1,
          warnings: []
        }
      })
    ).toThrow();
  });

  it("requires runId for run events but not for snapshot events", () => {
    expect(() =>
      WorkbenchEventSchema.parse({
        type: "run.stdout",
        sequence: 1,
        timestamp: "2026-04-28T00:00:00.000Z",
        payload: { chunk: "hello" }
      })
    ).toThrow(/runId/);

    expect(
      WorkbenchEventSchema.parse({
        type: "snapshot",
        sequence: 0,
        timestamp: "2026-04-28T00:00:00.000Z",
        payload: { service: "playwright-workbench-agent", version: "0.1.0" }
      })
    ).toEqual({
      type: "snapshot",
      sequence: 0,
      timestamp: "2026-04-28T00:00:00.000Z",
      payload: { service: "playwright-workbench-agent", version: "0.1.0" }
    });
  });

  it("rejects non-ISO timestamp in event envelope", () => {
    expect(() =>
      WorkbenchEventSchema.parse({
        type: "run.stdout",
        runId: "run-1",
        sequence: 1,
        timestamp: "not-a-date",
        payload: { chunk: "hello" }
      })
    ).toThrow();
  });
});
