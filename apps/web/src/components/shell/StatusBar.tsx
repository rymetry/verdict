// 画面下部の statusbar。
// - Agent 接続状態 (dot + バージョン + endpoint)
// - Local Agent との WebSocket 接続状態 (Issue #11 で追加: 通信不能を可視化する)
// - project / package manager
// - active run id
// - キーボードヒント (r 再実行 など)
import * as React from "react";

import {
  agentDotColorClass,
  type AgentDotState,
  wsDotColorClass,
  wsStateLabel
} from "@/components/shell/status";
import { cn } from "@/lib/utils";
import type { WsConnectionState } from "@/api/events";

interface StatusBarProps {
  /** Agent 接続状態 */
  agentState: AgentDotState;
  /** Agent のバージョン (取得できないときは undefined → "—" 表示) */
  agentVersion?: string;
  /** Agent endpoint (例: "127.0.0.1:4317") */
  agentEndpoint?: string;
  /** Workbench WebSocket 接続状態 (open / connecting / disconnected) */
  wsState: WsConnectionState;
  /** プロジェクト名 (未オープンのときは undefined) */
  projectName?: string | null;
  /** package manager 名 (例: "pnpm") */
  packageManager?: string | null;
  /** 直近の active run id */
  activeRunId?: string | null;
  className?: string;
}

interface KbdHint {
  keys: ReadonlyArray<string>;
  label: string;
}

const KEYBOARD_HINTS: ReadonlyArray<KbdHint> = [
  { keys: ["↵"], label: "開く" },
  { keys: ["r"], label: "再実行" },
  { keys: ["j", "k"], label: "次/前" },
  { keys: ["?"], label: "ショートカット一覧" }
];

function Segment({ children, className }: { children: React.ReactNode; className?: string }): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        // セパレータ: 隣接セグメント間に縦線を出す (CSS sibling 演算で自動描画)
        "[&+&]:before:mr-3 [&+&]:before:inline-block [&+&]:before:h-3 [&+&]:before:w-px [&+&]:before:bg-[var(--line)]",
        className
      )}
    >
      {children}
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <kbd className="inline-grid h-4 min-w-4 place-items-center rounded-sm border border-[var(--line)] bg-[var(--bg-1)] px-1 font-mono text-[10px] font-medium text-[var(--ink-2)]">
      {children}
    </kbd>
  );
}

export function StatusBar({
  agentState,
  agentVersion,
  agentEndpoint,
  wsState,
  projectName,
  packageManager,
  activeRunId,
  className
}: StatusBarProps): React.ReactElement {
  return (
    <footer
      aria-label="セッションステータス"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--line)] bg-[var(--bg-0)] px-6 py-2 text-[11.5px] text-[var(--ink-3)]",
        className
      )}
    >
      <Segment>
        <span
          aria-hidden="true"
          data-testid="agent-status-dot"
          data-agent-state={agentState}
          className={cn("h-1.5 w-1.5 rounded-full", agentDotColorClass(agentState))}
        />
        <span className="font-medium text-[var(--ink-1)]">
          {agentVersion ? `Agent v${agentVersion}` : "Agent —"}
        </span>
        {agentEndpoint ? <span>· {agentEndpoint}</span> : null}
      </Segment>

      <Segment>
        <span
          aria-hidden="true"
          data-testid="ws-status-dot"
          data-ws-state={wsState}
          className={cn("h-1.5 w-1.5 rounded-full", wsDotColorClass(wsState))}
        />
        <span className="font-medium text-[var(--ink-1)]">WS · {wsStateLabel(wsState)}</span>
      </Segment>

      {projectName ? (
        <Segment>
          project · {projectName}
          {packageManager ? ` · ${packageManager}` : ""}
        </Segment>
      ) : null}

      {activeRunId ? <Segment>run · #{activeRunId}</Segment> : null}

      <span className="flex-1" aria-hidden />

      {KEYBOARD_HINTS.map((hint) => (
        <Segment key={hint.label}>
          {hint.keys.map((k, i) => (
            <React.Fragment key={k}>
              {i > 0 ? <span aria-hidden>/</span> : null}
              <Kbd>{k}</Kbd>
            </React.Fragment>
          ))}
          <span>{hint.label}</span>
        </Segment>
      ))}
    </footer>
  );
}
