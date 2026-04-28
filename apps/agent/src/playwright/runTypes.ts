// Run-lifecycle internal types. Generic structured-log helpers live in
// `apps/agent/src/lib/structuredLog.ts`; re-exported below so existing
// run-scoped imports keep working without circular reference.
export {
  type ArtifactKind,
  errorCode,
  errorLogFields
} from "../lib/structuredLog.js";

/**
 * Structured logger contract for run lifecycle operations. `error` is required
 * so failures are never silently swallowed; `warn` and `info` are optional so
 * lightweight test doubles can opt out of success/info-level observability.
 *
 * Call sites pass a structured payload whose first arg includes `runId` and
 * (where applicable) `artifactKind` and `code`, so log aggregators can
 * correlate entries with the user-visible `code=...` strings that surface in
 * run warnings. Absolute filesystem paths must not be added to log payloads —
 * use `artifactKind` (closed `ArtifactKind` union) instead. The
 * `errorLogFields(error)` helper enforces this for thrown values.
 */
export interface RunManagerLogger {
  error(payload: Record<string, unknown>, message: string): void;
  warn?(payload: Record<string, unknown>, message: string): void;
  info?(payload: Record<string, unknown>, message: string): void;
  /** Production pino logger forwards debug; test stubs may omit it. */
  debug?(payload: Record<string, unknown>, message: string): void;
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
