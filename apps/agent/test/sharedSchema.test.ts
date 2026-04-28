import { describe, expect, it } from "vitest";
import {
  RunCompletedPayloadSchema,
  RunErrorPayloadSchema,
  RunListItemSchema
} from "@pwqa/shared";

describe("shared run warning schemas", () => {
  it("preserves warnings in terminal payloads and run list items", () => {
    const warnings = ["stdout log write failed; websocket stream was still delivered. code=ENOSPC; failures=1"];

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
});
