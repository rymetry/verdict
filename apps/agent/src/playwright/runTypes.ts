/**
 * Structured logger contract for run lifecycle operations. `error` is required
 * so failures are never silently swallowed; `warn` and `info` are optional so
 * lightweight test doubles can opt out of success/info-level observability.
 *
 * Call sites pass a structured payload whose first arg includes `runId` and
 * (where applicable) `artifactKind` and `code`, so log aggregators can
 * correlate entries with the user-visible `code=...` strings that surface in
 * run warnings.
 */
export interface RunManagerLogger {
  error(payload: Record<string, unknown>, message: string): void;
  warn?(payload: Record<string, unknown>, message: string): void;
  info?(payload: Record<string, unknown>, message: string): void;
}

/**
 * Extracts a string error code from an unknown thrown value. Returns `"UNKNOWN"`
 * for non-Error values or Errors without a `code` property. The fallback string
 * is significant: it appears in user-visible warning messages (e.g. `code=UNKNOWN`),
 * so callers can rely on getting a non-empty string.
 */
export function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "UNKNOWN";
}

/**
 * Stream redaction lifecycle: call `redact(stream, chunk)` for every output
 * chunk during the run, then call `flush()` exactly once at run completion to
 * collect any accumulated failure-warning strings for the terminal event.
 */
export interface StreamRedactor {
  redact(stream: "stdout" | "stderr", chunk: string): string;
  flush(): string[];
}
