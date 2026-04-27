import { useEffect, useMemo, useRef, useState } from "react";
import {
  RunCompletedPayloadSchema,
  RunStdStreamPayloadSchema,
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

export const initialRunConsoleState: RunConsoleState = {
  status: "idle",
  exitCode: null,
  stdout: [],
  stderr: []
};

const initialState = initialRunConsoleState;
const MAX_LINES = 1000;

function trim(lines: string[], next: string): string[] {
  if (lines.length < MAX_LINES) return [...lines, next];
  return [...lines.slice(lines.length - MAX_LINES + 1), next];
}

const STATUS_LABEL: Record<RunConsoleState["status"], string> = {
  idle: "idle",
  running: "running",
  passed: "passed",
  failed: "failed",
  cancelled: "cancelled",
  error: "error"
};

const STATUS_BADGE: Record<RunConsoleState["status"], string> = {
  idle: "skipped",
  running: "running",
  passed: "passed",
  failed: "failed",
  cancelled: "skipped",
  error: "failed"
};

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

  const headline = useMemo(() => {
    if (!activeRunId) return "アイドル — 上で run を開始してください";
    return `Run ${activeRunId.slice(0, 12)} · ${STATUS_LABEL[state.status]}`;
  }, [activeRunId, state.status]);

  return (
    <article className="locator-card" aria-label="Run console">
      <h4>
        Run コンソール
        <span style={{ marginLeft: 8 }}>
          <span className={`badge ${STATUS_BADGE[state.status]}`}>
            {STATUS_LABEL[state.status]}
          </span>
        </span>
      </h4>
      <div>
        <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>{headline}</p>
        {state.summary ? (
          <p
            style={{
              margin: "10px 0 0",
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius)",
              background: "var(--bg-2)",
              fontFamily: "var(--mono)",
              fontSize: 12.5,
              color: "var(--ink-0)",
              fontFeatureSettings: '"tnum" 1'
            }}
          >
            <span style={{ color: "var(--accent)", fontWeight: 600 }}>Σ </span>
            <span style={{ color: "var(--pass)" }}>{state.summary.passed} passed</span>
            {" · "}
            <span style={{ color: "var(--fail)" }}>{state.summary.failed} failed</span>
            {" · "}
            <span style={{ color: "var(--ink-2)" }}>{state.summary.skipped} skipped</span>
            {" · "}
            <span style={{ color: "var(--flaky)" }}>{state.summary.flaky} flaky</span>
            {" · total "}
            {state.summary.total}
            {state.durationMs ? ` · ${(state.durationMs / 1000).toFixed(1)}s` : ""}
          </p>
        ) : null}
        <pre
          ref={stdoutRef}
          className="terminal"
          style={{
            marginTop: 10,
            border: "1px solid var(--line)",
            borderLeft: "2px solid var(--accent)",
            borderRadius: "var(--radius)",
            maxHeight: 320,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          }}
        >
          {state.stdout.length > 0
            ? state.stdout.join("")
            : "▌ run の出力を待機中…"}
        </pre>
        {state.stderr.length > 0 ? (
          <details
            style={{
              marginTop: 10,
              border: "1px solid var(--line)",
              borderLeft: "2px solid var(--fail)",
              borderRadius: "var(--radius)"
            }}
          >
            <summary
              style={{
                padding: "8px 12px",
                color: "var(--fail)",
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: "pointer",
                fontWeight: 600
              }}
            >
              stderr
            </summary>
            <pre
              className="terminal"
              style={{
                margin: 0,
                padding: "0 12px 12px",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word"
              }}
            >
              {state.stderr.join("")}
            </pre>
          </details>
        ) : null}
      </div>
    </article>
  );
}

export function applyEvent(state: RunConsoleState, event: WorkbenchEvent): RunConsoleState {
  switch (event.type) {
    case "run.queued":
      return { ...state, status: "running" };
    case "run.started":
      return { ...state, status: "running" };
    case "run.stdout": {
      const parsed = RunStdStreamPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return state;
      return { ...state, stdout: trim(state.stdout, parsed.data.chunk) };
    }
    case "run.stderr": {
      const parsed = RunStdStreamPayloadSchema.safeParse(event.payload);
      if (!parsed.success) return state;
      return { ...state, stderr: trim(state.stderr, parsed.data.chunk) };
    }
    case "run.completed":
    case "run.cancelled":
    case "run.error": {
      const parsed = RunCompletedPayloadSchema.safeParse(event.payload);
      const payload = parsed.success ? parsed.data : null;
      const status: RunConsoleState["status"] =
        event.type === "run.cancelled"
          ? "cancelled"
          : event.type === "run.error"
            ? "error"
            : payload?.status === "passed"
              ? "passed"
              : payload?.status === "failed"
                ? "failed"
                : "error";
      return {
        ...state,
        status,
        exitCode: payload?.exitCode ?? null,
        durationMs: payload?.durationMs ?? state.durationMs,
        summary: payload?.summary
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
