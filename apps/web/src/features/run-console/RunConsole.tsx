// 進行中 run の stdout/stderr を WebSocket 経由で表示するパネル。
// δ (Issue #11) で Tailwind + shadcn primitives へ移植した。
//
// 配線:
//  - eventStream は WorkbenchEventsContext から取得する (RootLayout で生成された singleton)。
//  - activeRunId は run-store から購読 (qa.tsx で渡す)。
//  - state machine は initial state + applyEvent で immutable に更新する。
//
// silent failure ガード:
//  - WS envelope の parse 失敗は events.ts 側で console.error する。
//  - **payload 内側** (RunStdStreamPayload / RunCompletedPayload) の schema 不一致は
//    本ファイルの applyEvent で `console.error` する (envelope の `payload: z.unknown()` ゆえ
//    events.ts では検知できない経路を本層で塞ぐ)。
//  - state listener 内 throw は events.ts 側で握り潰さず log する。
import * as React from "react";
import {
  RunCompletedPayloadSchema,
  RunStdStreamPayloadSchema,
  type WorkbenchEvent
} from "@pwqa/shared";

import type { EventStream } from "@/api/events";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface RunConsoleProps {
  eventStream: EventStream;
  activeRunId: string | null;
}

export interface RunConsoleState {
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

const MAX_LINES = 1000;

function trim(lines: string[], next: string): string[] {
  if (lines.length < MAX_LINES) return [...lines, next];
  return [...lines.slice(lines.length - MAX_LINES + 1), next];
}

export function RunConsole({ eventStream, activeRunId }: RunConsoleProps): React.ReactElement {
  const [state, setState] = React.useState<RunConsoleState>(initialRunConsoleState);
  const stdoutRef = React.useRef<HTMLPreElement>(null);

  // activeRunId が変化したら旧 run の log を残さないよう state を毎回リセットする。
  // useEffect 1 個で「reset → subscribe → cleanup」を扱うと null 遷移時の reset が
  // 走らないため、reset と subscribe を分離する。
  React.useEffect(() => {
    setState(initialRunConsoleState);
  }, [activeRunId]);

  React.useEffect(() => {
    if (!activeRunId) return undefined;
    const unsubscribe = eventStream.subscribe((event: WorkbenchEvent) => {
      if (event.runId !== activeRunId) return;
      setState((current) => applyEvent(current, event));
    });
    return () => {
      unsubscribe();
    };
  }, [eventStream, activeRunId]);

  React.useEffect(() => {
    if (stdoutRef.current) {
      stdoutRef.current.scrollTop = stdoutRef.current.scrollHeight;
    }
  }, [state.stdout]);

  const statusLabel = activeRunId
    ? `Run ${activeRunId.slice(0, 12)} · ${state.status}`
    : "Idle — テスト実行は左カラムから開始します。";

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Run console</span>
          <RunStatusBadge status={state.status} />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-[var(--ink-3)]">{statusLabel}</p>
        {state.summary ? (
          <p className="mt-2 text-sm font-semibold text-[var(--ink-1)]">
            {state.summary.passed} passed · {state.summary.failed} failed ·{" "}
            {state.summary.skipped} skipped · {state.summary.flaky} flaky · total{" "}
            {state.summary.total}
            {state.durationMs ? ` · ${(state.durationMs / 1000).toFixed(1)}s` : ""}
          </p>
        ) : null}
        <pre
          ref={stdoutRef}
          aria-label="標準出力"
          className={cn(
            "mt-3 max-h-[40vh] overflow-auto rounded-md border border-[var(--line)]",
            // デザインモックの `.terminal` と同じ白基調 + token 駆動に揃える。
            "bg-[var(--bg-0)] p-3 font-mono text-[12px] leading-[1.65] text-[var(--ink-1)]",
            "whitespace-pre-wrap break-words"
          )}
        >
          {state.stdout.join("")}
        </pre>
        {state.stderr.length > 0 ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-[var(--ink-2)]">
              stderr
            </summary>
            <pre
              aria-label="標準エラー"
              className={cn(
                "mt-2 max-h-[30vh] overflow-auto rounded-md border border-[var(--fail)]",
                "bg-[var(--fail-soft)] p-3 font-mono text-[12px] leading-[1.65] text-[var(--fail)]",
                "whitespace-pre-wrap break-words"
              )}
            >
              {state.stderr.join("")}
            </pre>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RunStatusBadge({ status }: { status: RunConsoleState["status"] }): React.ReactElement | null {
  switch (status) {
    case "idle":
      return <Badge variant="outline">Idle</Badge>;
    case "running":
      return <Badge variant="info">Running</Badge>;
    case "passed":
      return <Badge variant="pass">Passed</Badge>;
    case "failed":
      return <Badge variant="fail">Failed</Badge>;
    case "cancelled":
      return <Badge variant="default">Cancelled</Badge>;
    case "error":
      return <Badge variant="fail">Error</Badge>;
  }
}

export function applyEvent(state: RunConsoleState, event: WorkbenchEvent): RunConsoleState {
  switch (event.type) {
    case "run.queued":
      return { ...state, status: "running" };
    case "run.started":
      return { ...state, status: "running" };
    case "run.stdout": {
      const parsed = RunStdStreamPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        // payload schema 不一致は Agent contract 違反。silent drop は run の log を黙って欠落させる。
        // eslint-disable-next-line no-console -- payload 不一致を本番でも検知
        console.error("[RunConsole] run.stdout payload schema mismatch", parsed.error.issues);
        return state;
      }
      return { ...state, stdout: trim(state.stdout, parsed.data.chunk) };
    }
    case "run.stderr": {
      const parsed = RunStdStreamPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        // eslint-disable-next-line no-console -- payload 不一致を本番でも検知
        console.error("[RunConsole] run.stderr payload schema mismatch", parsed.error.issues);
        return state;
      }
      return { ...state, stderr: trim(state.stderr, parsed.data.chunk) };
    }
    case "run.completed":
    case "run.cancelled":
    case "run.error": {
      const parsed = RunCompletedPayloadSchema.safeParse(event.payload);
      if (!parsed.success) {
        // run.cancelled / run.error は payload を捨てても status の決定は可能だが、
        // run.completed は status を payload から取るため不一致だと "error" にフォールバックされ silent。
        // eslint-disable-next-line no-console -- payload 不一致を本番でも検知
        console.error(`[RunConsole] ${event.type} payload schema mismatch`, parsed.error.issues);
      }
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
    case "snapshot":
      // snapshot は WS reconnect 直後の Agent 側 replay 用 envelope。RunConsole は state を
      // 既に保持しているため、ここで再適用すると重複表示になる。意図的に no-op にする
      // (caller が必要なら separate hook で処理する)。
      return state;
    default: {
      // exhaustiveness: WorkbenchEvent に新 type が追加された際に compile error で気付く。
      // ランタイムにここへ来たら schema 拡張漏れが本番で起きているので痕跡を残す。
      const _exhaustive: never = event.type;
      // eslint-disable-next-line no-console -- 未対応 event type を本番でも検知
      console.warn("[RunConsole] unhandled event type", _exhaustive);
      return state;
    }
  }
}
