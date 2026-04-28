import { type RunCancellationReason } from "@pwqa/shared";
import type { CommandResult } from "../commands/runner.js";

interface RunOutcomeBase {
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
}

/**
 * Discriminated union by `status`: `cancelReason` is statically required for
 * cancelled outcomes (eliminating the runtime invariant "cancelled implies
 * cancelReason exists" via the type system). `warning` carries the
 * human-readable cause on error outcomes — currently only the timeout
 * message ("Run timed out and was terminated."). Other failure modes
 * propagate detail through structured logs and metadata warnings rather
 * than this field.
 */
export type RunOutcome =
  | (RunOutcomeBase & { status: "passed" | "failed" })
  | (RunOutcomeBase & { status: "cancelled"; cancelReason: RunCancellationReason })
  | (RunOutcomeBase & { status: "error"; warning?: string });

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
