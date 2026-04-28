import { describe, expect, it } from "vitest";
import { createEventBus } from "../src/events/bus.js";
import type { WorkbenchEventInput } from "@pwqa/shared";

const payloadCases: Array<[WorkbenchEventInput["type"], unknown, unknown]> = [
  [
    "run.queued",
    { request: { projectId: "p1", headed: false } },
    { request: { projectId: 123 } }
  ],
  [
    "run.started",
    { command: { executable: "node", args: [] }, cwd: "/tmp/project", startedAt: "2026-04-28T00:00:00Z" },
    { command: { executable: "node" } }
  ],
  ["run.stdout", { chunk: "hello" }, { notChunk: "hello" }],
  ["run.stderr", { chunk: "warn" }, { notChunk: "warn" }],
  [
    "run.completed",
    { exitCode: 0, status: "passed", durationMs: 1, warnings: [] },
    { exitCode: 0, status: "error", durationMs: 1, warnings: [] }
  ],
  [
    "run.cancelled",
    { exitCode: null, status: "cancelled", durationMs: 1, warnings: [] },
    { exitCode: null, status: "passed", durationMs: 1, warnings: [] }
  ],
  [
    "run.error",
    {
      message: "Runner failed after spawn.",
      exitCode: 1,
      status: "error",
      durationMs: 1,
      warnings: ["Runner failed after spawn. code=UNKNOWN"]
    },
    { exitCode: 1, status: "error", durationMs: 1, warnings: [] }
  ],
  ["snapshot", { service: "playwright-workbench-agent", version: "0.1.0" }, { service: 1 }]
];

describe("EventBus", () => {
  it.each(payloadCases)("validates %s payloads before publishing", (type, validPayload, invalidPayload) => {
    const bus = createEventBus();

    expect(() =>
      bus.publish({
        type,
        runId: "run-1",
        payload: invalidPayload as never
      } as unknown as WorkbenchEventInput)
    ).toThrow(new RegExp(`Invalid ${type} payload`));
    const event = bus.publish({
      type,
      runId: "run-1",
      payload: validPayload as never
    } as unknown as WorkbenchEventInput);

    expect(event.sequence).toBe(1);
    expect(bus.snapshot("run-1")).toEqual([event]);
  });
});
