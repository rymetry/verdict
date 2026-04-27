import { useEffect, useMemo, useRef, useState } from "react";
import {
  type RunCompletedPayload,
  type RunStdStreamPayload,
  type WorkbenchEvent
} from "@pwqa/shared";
import type { EventStream } from "../../api/events";

interface RunConsoleProps {
  eventStream?: EventStream;
  activeRunId?: string;
}

interface RunConsoleState {
  status: "idle" | "running" | "passed" | "failed" | "cancelled" | "error";
  exitCode: number | null;
  stdout: string[];
  stderr: string[];
  durationMs?: number;
  summary?: { total: number; passed: number; failed: number; skipped: number; flaky: number };
}

const initialState: RunConsoleState = {
  status: "idle",
  exitCode: null,
  stdout: [],
  stderr: []
};

const MAX_LINES = 1000;

function trim(lines: string[], next: string): string[] {
  if (lines.length < MAX_LINES) return [...lines, next];
  return [...lines.slice(lines.length - MAX_LINES + 1), next];
}

export function RunConsole({ eventStream, activeRunId }: RunConsoleProps) {
  const [state, setState] = useState<RunConsoleState>(initialState);
  const stdoutRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!eventStream || !activeRunId) return undefined;
    setState(initialState);
    const unsubscribe = eventStream.subscribe((event: WorkbenchEvent) => {
      if (event.runId !== activeRunId) return;
      setState((current) => applyEvent(current, event));
    });
    return () => {
      unsubscribe();
    };
  }, [eventStream, activeRunId]);

  useEffect(() => {
    if (stdoutRef.current) {
      stdoutRef.current.scrollTop = stdoutRef.current.scrollHeight;
    }
  }, [state.stdout]);

  const statusLabel = useMemo(() => {
    if (!activeRunId) return "Idle — start a run from the inventory above.";
    return `Run ${activeRunId.slice(0, 12)} · ${state.status}`;
  }, [activeRunId, state.status]);

  return (
    <article className="panel panelPrimary">
      <p className="panelLabel">Run console</p>
      <p className="muted">{statusLabel}</p>
      {state.summary ? (
        <p className="summary">
          {state.summary.passed} passed · {state.summary.failed} failed · {state.summary.skipped}{" "}
          skipped · {state.summary.flaky} flaky · total {state.summary.total}
          {state.durationMs ? ` · ${(state.durationMs / 1000).toFixed(1)}s` : ""}
        </p>
      ) : null}
      <pre ref={stdoutRef} className="console">
        {state.stdout.join("")}
      </pre>
      {state.stderr.length > 0 ? (
        <details className="stderr">
          <summary>stderr</summary>
          <pre>{state.stderr.join("")}</pre>
        </details>
      ) : null}
    </article>
  );
}

function applyEvent(state: RunConsoleState, event: WorkbenchEvent): RunConsoleState {
  switch (event.type) {
    case "run.queued":
      return { ...state, status: "running" };
    case "run.started":
      return { ...state, status: "running" };
    case "run.stdout": {
      const payload = event.payload as RunStdStreamPayload;
      return { ...state, stdout: trim(state.stdout, payload.chunk) };
    }
    case "run.stderr": {
      const payload = event.payload as RunStdStreamPayload;
      return { ...state, stderr: trim(state.stderr, payload.chunk) };
    }
    case "run.completed":
    case "run.cancelled":
    case "run.error": {
      const payload = event.payload as Partial<RunCompletedPayload>;
      const status: RunConsoleState["status"] =
        event.type === "run.cancelled"
          ? "cancelled"
          : event.type === "run.error"
            ? "error"
            : payload.status === "passed"
              ? "passed"
              : payload.status === "failed"
                ? "failed"
                : "error";
      return {
        ...state,
        status,
        exitCode: payload.exitCode ?? null,
        durationMs: payload.durationMs ?? state.durationMs,
        summary: payload.summary
          ? {
              total: payload.summary.total,
              passed: payload.summary.passed,
              failed: payload.summary.failed,
              skipped: payload.summary.skipped,
              flaky: payload.summary.flaky
            }
          : state.summary
      };
    }
    default:
      return state;
  }
}
