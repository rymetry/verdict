import { describe, expect, it } from "vitest";
import { deriveOutcome } from "../src/playwright/runOutcome";
import type { CommandResult } from "../src/commands/runner";

function makeResult(partial: Partial<CommandResult>): CommandResult {
  return {
    exitCode: 0,
    signal: null,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: 0,
    stdout: "",
    stderr: "",
    cancelled: false,
    timedOut: false,
    command: { executable: "node", args: [], cwd: "/tmp" },
    ...partial
  };
}

describe("deriveOutcome", () => {
  it("returns passed for exit code 0", () => {
    const outcome = deriveOutcome(makeResult({ exitCode: 0 }), new Date());
    expect(outcome.status).toBe("passed");
    expect(outcome.warning).toBeUndefined();
  });

  it("returns failed for non-zero exit code", () => {
    const outcome = deriveOutcome(makeResult({ exitCode: 7 }), new Date());
    expect(outcome.status).toBe("failed");
    expect(outcome.exitCode).toBe(7);
  });

  it("returns cancelled when CommandResult.cancelled is true", () => {
    const outcome = deriveOutcome(makeResult({ cancelled: true, exitCode: 143 }), new Date());
    expect(outcome.status).toBe("cancelled");
  });

  it("returns error with warning when timedOut", () => {
    const outcome = deriveOutcome(makeResult({ timedOut: true }), new Date());
    expect(outcome.status).toBe("error");
    expect(outcome.warning).toMatch(/timed out/i);
  });

  it("returns error when exitCode is null and not cancelled/timedOut", () => {
    const outcome = deriveOutcome(makeResult({ exitCode: null }), new Date());
    expect(outcome.status).toBe("error");
  });
});
