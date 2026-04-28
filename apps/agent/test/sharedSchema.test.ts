import { describe, expect, it } from "vitest";
import {
  RunCompletedPayloadSchema,
  RunCancelledPayloadSchema,
  RunErrorPayloadSchema,
  RunListItemSchema
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
        exitCode: null,
        signal: null,
        status: "error",
        durationMs: 123
      }).warnings
    ).toEqual([]);
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
});
