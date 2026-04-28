import { type RedactionResult } from "../commands/redact.js";
import {
  type ArtifactKind,
  type ArtifactOperation,
  errorCode
} from "../lib/structuredLog.js";
import { type RunManagerLogger, type StreamRedactor } from "./runTypes.js";

export { type StreamRedactor };

/**
 * Issue #31: stream の identity (`stdout-log` / `stderr-log`) を直接 logger
 * 上の `artifactKind` として emit し、`op: "stream-redaction"` で operation を
 * 軸として併記する。旧 schema の `stream: "stdout" | "stderr"` 補助 field と
 * `artifactKind: "stream-redaction"` の 2 軸表現を、identity-only の 1 軸表現
 * に統一する。
 */
function streamIdentity(stream: "stdout" | "stderr"): ArtifactKind {
  return stream === "stdout" ? "stdout-log" : "stderr-log";
}

/**
 * Redaction failure is handled fail-closed for output chunks: the raw chunk is
 * discarded and a placeholder is delivered instead, then the loss is surfaced
 * through final run warnings without logging the secret-bearing input.
 */
export function createStreamRedactor({
  redactor,
  logger,
  runId
}: {
  redactor: (chunk: string) => RedactionResult;
  logger?: RunManagerLogger;
  runId: string;
}): StreamRedactor {
  const failures: Record<"stdout" | "stderr", { count: number; firstCode: string; codes: Set<string>; bytes: number }> = {
    stdout: { count: 0, firstCode: "UNKNOWN", codes: new Set(), bytes: 0 },
    stderr: { count: 0, firstCode: "UNKNOWN", codes: new Set(), bytes: 0 }
  };
  const loggedCodes: Record<"stdout" | "stderr", Set<string>> = {
    stdout: new Set(),
    stderr: new Set()
  };
  const successes: Record<"stdout" | "stderr", { chunks: number; replacements: number }> = {
    stdout: { chunks: 0, replacements: 0 },
    stderr: { chunks: 0, replacements: 0 }
  };

  function recordFailure(stream: "stdout" | "stderr", chunk: string, error: unknown): void {
    const code = errorCode(error);
    const current = failures[stream];
    failures[stream] = {
      count: current.count + 1,
      firstCode: current.count === 0 ? code : current.firstCode,
      codes: new Set([...current.codes, code]),
      bytes: current.bytes + Buffer.byteLength(chunk, "utf8")
    };
    if (!loggedCodes[stream].has(code)) {
      loggedCodes[stream].add(code);
      logger?.error(
        {
          runId,
          artifactKind: streamIdentity(stream),
          op: "stream-redaction" satisfies ArtifactOperation,
          code,
          errorName: error instanceof Error ? error.name : typeof error
        },
        "run stream redaction failed"
      );
    }
  }

  return {
    redact(stream, chunk) {
      try {
        const result = redactor(chunk);
        if (result.replacements > 0) {
          const previous = successes[stream];
          successes[stream] = {
            chunks: previous.chunks + 1,
            replacements: previous.replacements + result.replacements
          };
        }
        return result.value;
      } catch (error) {
        recordFailure(stream, chunk, error);
        return "[redaction failed]\n";
      }
    },
    flush() {
      return (["stdout", "stderr"] as const).flatMap((stream) => {
        const success = successes[stream];
        // Single per-stream summary log: cumulative counts at run completion.
        // We deliberately do not emit a per-chunk "redaction applied" event to
        // keep one canonical observability record per run/stream.
        if (success.replacements > 0) {
          logger?.info?.(
            {
              runId,
              artifactKind: streamIdentity(stream),
              op: "stream-redaction" satisfies ArtifactOperation,
              chunks: success.chunks,
              replacements: success.replacements
            },
            "run stream redaction summary"
          );
        }
        const failure = failures[stream];
        if (failure.count === 0) return [];
        const codes = Array.from(failure.codes).join(",");
        return [
          `${stream} redaction failed; raw output was replaced before websocket/log delivery. code=${failure.firstCode}; codes=${codes}; failures=${failure.count}; bytes=${failure.bytes}`
        ];
      });
    }
  };
}
