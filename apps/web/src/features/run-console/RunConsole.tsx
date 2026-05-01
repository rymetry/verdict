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
//  - **payload 内側** (RunStdStreamPayload / RunTerminalPayload) の schema 不一致と
//    terminal event type/status の不一致は本ファイルの applyEvent で `console.error` する
//    (古い Agent や再接続履歴が壊れた payload を届けた場合の防御層)。
//  - state listener 内 throw は events.ts 側で握り潰さず log する。
import * as React from "react";
import {
  RunStdStreamPayloadSchema,
  RunTerminalPayloadSchema,
  isTerminalEventType,
  terminalStatusMatchesEvent,
  type RunCancellationReason,
  type EvidenceArtifact,
  type RunMetadata,
  type RunTerminalPayload,
  type WorkbenchEvent
} from "@pwqa/shared";

import type { EventStream } from "@/api/events";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { RunWarningsAlert } from "./RunWarningsAlert";

interface RunConsoleProps {
  eventStream: EventStream;
  activeRunId: string | null;
  runSnapshot?: RunMetadata | null;
}

export interface RunConsoleState {
  status: "idle" | "running" | "passed" | "failed" | "cancelled" | "error";
  exitCode: number | null;
  stdout: string[];
  stderr: string[];
  warnings: string[];
  cancelReason?: RunCancellationReason;
  durationMs?: number;
  summary?: { total: number; passed: number; failed: number; skipped: number; flaky: number };
  artifactLinks: EvidenceArtifactLink[];
}

interface EvidenceArtifactLink {
  key: string;
  kind: EvidenceArtifact["kind"];
  label: string;
  href: string;
}

export const initialRunConsoleState: RunConsoleState = {
  status: "idle",
  exitCode: null,
  stdout: [],
  stderr: [],
  warnings: [],
  artifactLinks: []
};

const MAX_LINES = 1000;
const TERMINAL_PAYLOAD_WARNING =
  "Run console: terminal payload could not be parsed; some terminal fields were ignored.";

function trim(lines: string[], next: string): string[] {
  if (lines.length < MAX_LINES) return [...lines, next];
  return [...lines.slice(lines.length - MAX_LINES + 1), next];
}

function applyTerminalFields(
  state: RunConsoleState,
  payload: { exitCode: number | null; durationMs: number; warnings: string[] } | null
): Pick<RunConsoleState, "exitCode" | "durationMs" | "warnings"> {
  return {
    exitCode: payload?.exitCode ?? null,
    durationMs: payload?.durationMs ?? state.durationMs,
    warnings: payload?.warnings ?? state.warnings
  };
}

type TerminalPayloadParseResult =
  | { ok: true; payload: RunTerminalPayload }
  | { ok: false; reason: "schema-mismatch"; issues: Array<{ message: string }> }
  | {
      ok: false;
      reason: "event-type-mismatch";
      issues: Array<{ message: string }>;
    };

function parseTerminalPayload(event: WorkbenchEvent): TerminalPayloadParseResult {
  if (!isTerminalEventType(event.type)) {
    return {
      ok: false,
      reason: "event-type-mismatch",
      issues: [{ message: `event ${event.type} is not a terminal event` }]
    };
  }
  const parsed = RunTerminalPayloadSchema.safeParse(event.payload);
  if (!parsed.success) {
    return { ok: false, reason: "schema-mismatch", issues: parsed.error.issues };
  }
  if (!terminalStatusMatchesEvent(event.type, parsed.data.status)) {
    return {
      ok: false,
      reason: "event-type-mismatch",
      issues: [
        {
          message: `status ${parsed.data.status} does not match event type ${event.type}`
        }
      ]
    };
  }
  return { ok: true, payload: parsed.data };
}

function logTerminalPayloadMismatch(event: WorkbenchEvent, parsed: Exclude<TerminalPayloadParseResult, { ok: true }>): void {
  const label =
    parsed.reason === "event-type-mismatch"
      ? "payload event/status mismatch"
      : "payload schema mismatch";
  // eslint-disable-next-line no-console -- payload 不一致を本番でも検知
  console.error(`[RunConsole] ${event.type} ${label}`, parsed.issues);
}

function appendWarning(warnings: string[], warning: string): string[] {
  return warnings.includes(warning) ? warnings : [...warnings, warning];
}

function cancelReasonLabel(reason: RunCancellationReason): string {
  switch (reason) {
    case "user-request":
      return "Cancelled by user request";
    case "internal":
      return "Cancelled by workbench";
    default: {
      const _exhaustive: never = reason;
      return `Cancelled (${String(_exhaustive)})`;
    }
  }
}

export function RunConsole({
  eventStream,
  activeRunId,
  runSnapshot = null
}: RunConsoleProps): React.ReactElement {
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
      if (!("runId" in event) || event.runId !== activeRunId) return;
      setState((current) => applyEvent(current, event));
    });
    return () => {
      unsubscribe();
    };
  }, [eventStream, activeRunId]);

  React.useEffect(() => {
    if (!activeRunId || !runSnapshot || runSnapshot.runId !== activeRunId) return;
    setState((current) => mergeRunSnapshot(current, runSnapshot));
  }, [activeRunId, runSnapshot]);

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
        {state.status === "cancelled" && state.cancelReason ? (
          <p className="mt-2 text-sm font-medium text-[var(--ink-2)]">
            {cancelReasonLabel(state.cancelReason)}
          </p>
        ) : null}
        {state.summary ? (
          <p className="mt-2 text-sm font-semibold text-[var(--ink-1)]">
            {state.summary.passed} passed · {state.summary.failed} failed ·{" "}
            {state.summary.skipped} skipped · {state.summary.flaky} flaky · total{" "}
            {state.summary.total}
            {state.durationMs ? ` · ${(state.durationMs / 1000).toFixed(1)}s` : ""}
          </p>
        ) : null}
        <RunWarningsAlert warnings={state.warnings} />
        {state.artifactLinks.length > 0 ? (
          <ul
            className="mt-3 flex flex-wrap gap-2"
            aria-label="Evidence artifact links"
          >
            {state.artifactLinks.map((artifact) => (
              <li key={artifact.key}>
                <a
                  className="inline-flex h-8 items-center rounded-md border border-[var(--line-strong)] bg-[var(--bg-elev)] px-3 text-xs font-medium text-[var(--ink-1)] hover:bg-[var(--bg-1)]"
                  href={artifact.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {artifact.kind}: {artifact.label}
                </a>
              </li>
            ))}
          </ul>
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

function mergeRunSnapshot(
  state: RunConsoleState,
  run: RunMetadata
): RunConsoleState {
  const status: RunConsoleState["status"] =
    run.status === "queued" || run.status === "running" ? "running" : run.status;
  return {
    ...state,
    status,
    exitCode: run.exitCode ?? null,
    cancelReason: run.cancelReason,
    durationMs: run.durationMs ?? state.durationMs,
    warnings: run.warnings,
    artifactLinks: run.summary ? evidenceLinksForRun(run.runId, run.summary) : [],
    summary: run.summary
      ? {
          total: run.summary.total,
          passed: run.summary.passed,
          failed: run.summary.failed,
          skipped: run.summary.skipped,
          flaky: run.summary.flaky
        }
      : state.summary
  };
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
    case "run.completed": {
      // terminal event の status は event.type と payload.status の両方で確認する。
      // payload が壊れても cancelled/error と誤認せず、この event は error fallback に留める。
      const parsed = parseTerminalPayload(event);
      if (!parsed.ok) {
        logTerminalPayloadMismatch(event, parsed);
      }
      const payload =
        parsed.ok && (parsed.payload.status === "passed" || parsed.payload.status === "failed")
          ? parsed.payload
          : null;
      const status: RunConsoleState["status"] =
        payload?.status === "passed" ? "passed" : payload?.status === "failed" ? "failed" : "error";
      return {
        ...state,
        status,
        ...applyTerminalFields(state, payload),
        warnings: payload?.warnings ?? appendWarning(state.warnings, TERMINAL_PAYLOAD_WARNING),
        artifactLinks: payload?.summary ? evidenceLinksForRun(event.runId, payload.summary) : state.artifactLinks,
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
    case "run.cancelled": {
      // event.type が cancelled なら UI status は cancelled で確定。payload は exit/duration/warnings
      // を補うためだけに使い、schema 不一致はログに残して既存 state を保つ。
      const parsed = parseTerminalPayload(event);
      if (!parsed.ok) {
        logTerminalPayloadMismatch(event, parsed);
      }
      const payload = parsed.ok ? parsed.payload : null;
      return {
        ...state,
        status: "cancelled",
        ...applyTerminalFields(state, payload),
        cancelReason: payload?.status === "cancelled" ? payload.cancelReason : state.cancelReason,
        warnings: payload?.warnings ?? appendWarning(state.warnings, TERMINAL_PAYLOAD_WARNING)
      };
    }
    case "run.error": {
      // event.type が error なら UI status は error で確定。message は UI に出さず、
      // ユーザー向け詳細は sanitized warnings に限定する。
      const parsed = parseTerminalPayload(event);
      if (!parsed.ok) {
        logTerminalPayloadMismatch(event, parsed);
      }
      const payload = parsed.ok ? parsed.payload : null;
      return {
        ...state,
        status: "error",
        ...applyTerminalFields(state, payload),
        warnings: payload?.warnings ?? appendWarning(state.warnings, TERMINAL_PAYLOAD_WARNING)
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
      const _exhaustive: never = event;
      // eslint-disable-next-line no-console -- 未対応 event type を本番でも検知
      console.warn("[RunConsole] unhandled event type", _exhaustive);
      return state;
    }
  }
}

function evidenceLinksForRun(
  runId: string,
  summary: NonNullable<RunMetadata["summary"]>
): EvidenceArtifactLink[] {
  const links: EvidenceArtifactLink[] = [];
  summary.failedTests.forEach((test, failureIndex) => {
    test.attachments.forEach((attachment, attachmentIndex) => {
      if (!isLinkableEvidence(attachment.kind)) return;
      links.push({
        key: `${failureIndex}-${attachmentIndex}`,
        kind: attachment.kind,
        label: attachment.label,
        href: `/api/runs/${encodeURIComponent(runId)}/evidence/${failureIndex}/${attachmentIndex}`
      });
    });
  });
  return links;
}

function isLinkableEvidence(kind: EvidenceArtifact["kind"]): boolean {
  return kind === "trace" || kind === "screenshot" || kind === "video";
}
