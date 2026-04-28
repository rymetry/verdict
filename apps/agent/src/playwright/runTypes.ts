/**
 * Closed string union for structured-log artifact identification. Logger call
 * sites use `artifactKind: "..." satisfies ArtifactKind` instead of including
 * absolute filesystem paths, so log aggregators / bug reports / support
 * snippets cannot leak `/Users/<username>/...` or internal directory layout
 * (Issue #27). Run-scoped paths can always be reconstructed from `runId` via
 * `runPathsFor()`; project-scoped paths surface through the dedicated
 * `Initial project loaded` startup log.
 */
export type ArtifactKind =
  | "playwright-json"
  | "playwright-json-redaction"
  | "playwright-json-summary"
  | "stdout-log"
  | "stderr-log"
  | "metadata"
  | "html-report"
  | "stream-redaction"
  | "log"
  | "runs-directory"
  | "audit-log";

/**
 * Structured logger contract for run lifecycle operations. `error` is required
 * so failures are never silently swallowed; `warn` and `info` are optional so
 * lightweight test doubles can opt out of success/info-level observability.
 *
 * Call sites pass a structured payload whose first arg includes `runId` and
 * (where applicable) `artifactKind` and `code`, so log aggregators can
 * correlate entries with the user-visible `code=...` strings that surface in
 * run warnings. Absolute filesystem paths must not be added to log payloads —
 * use `artifactKind` (closed `ArtifactKind` union) instead.
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
 * Returns a structured-log payload fragment summarizing an unknown thrown
 * value. ErrnoException messages embed the failing absolute filesystem path
 * (e.g. `ENOENT: no such file or directory, open '/Users/...'`); structured
 * logs must not leak that, so for errors carrying a `.code` property we keep
 * only the code and drop the message. For non-fs errors we preserve the
 * message so unexpected exceptions remain debuggable.
 */
export function errorLogFields(error: unknown): { code: string; err?: string } {
  const code = errorCode(error);
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return { code };
  }
  if (error instanceof Error) {
    return { code, err: error.message };
  }
  return { code, err: String(error) };
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
