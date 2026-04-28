import { describe, expect, it } from "vitest";
import { createEventBus } from "../src/events/bus.js";

describe("EventBus", () => {
  it("rejects invalid terminal payloads before publishing", () => {
    const bus = createEventBus();

    expect(() =>
      bus.publish({
        type: "run.error",
        runId: "run-1",
        payload: {
          exitCode: 1,
          status: "error",
          durationMs: 1,
          warnings: []
        }
      })
    ).toThrow(/Invalid run\.error payload/);
  });

  it("publishes valid terminal payloads after runtime schema validation", () => {
    const bus = createEventBus();
    const event = bus.publish({
      type: "run.error",
      runId: "run-1",
      payload: {
        message: "Runner failed after spawn.",
        exitCode: 1,
        status: "error",
        durationMs: 1,
        warnings: ["Runner failed after spawn. code=UNKNOWN"]
      }
    });

    expect(event.sequence).toBe(1);
    expect(bus.snapshot("run-1")).toEqual([event]);
  });
});
