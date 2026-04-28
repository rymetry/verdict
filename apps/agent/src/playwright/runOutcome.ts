import { type RunCancellationReason, type RunStatus } from "@pwqa/shared";
import type { CommandResult } from "../commands/runner.js";

export interface RunOutcome {
  status: RunStatus;
  exitCode: number | null;
  signal: string | null;
  cancelReason?: RunCancellationReason;
  durationMs: number;
  warning?: string;
}

/**
 * Pure function that maps a CommandResult into a Workbench RunStatus.
 * Lives in its own module so it can be unit-tested without filesystem or
 * subprocess fixtures (SRP / SLAP).
 */
export function deriveOutcome(result: CommandResult, startedAt: Date): RunOutcome {
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  if (result.cancelled) {
    return {
      status: "cancelled",
      exitCode: result.exitCode,
      signal: result.signal,
      cancelReason: result.cancelReason ?? "internal",
      durationMs
    };
  }
  if (result.timedOut) {
    return {
      status: "error",
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs,
      warning: "Run timed out and was terminated."
    };
  }
  if (result.exitCode === 0) {
    return { status: "passed", exitCode: 0, signal: null, durationMs };
  }
  if (typeof result.exitCode === "number") {
    return { status: "failed", exitCode: result.exitCode, signal: result.signal, durationMs };
  }
  return { status: "error", exitCode: null, signal: result.signal, durationMs };
}
