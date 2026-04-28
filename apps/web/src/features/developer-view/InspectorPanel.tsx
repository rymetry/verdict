// Developer View 右カラム: Locator / Console / Run metadata の 3 サブカード placeholder。
//
// Phase 1.2 で接続する際の置換:
//  - Locator: ts-morph (PLAN.v2 §24 / Phase 5/7) ベースの解析 or `playwright test --debug` 出力
//  - Console: Phase 1.2 で `run.stdout/stderr` から browser console 行をフィルタ抽出するか、
//    別 event type を導入するかを検討する (run-console と同じ WebSocket event source を再利用予定)。
//  - Run metadata: GET /runs/:runId の response (既存 endpoint)
//
// Phase 1.2 INVARIANT (silent failure 防衛):
//  - WS event の payload は **必ず** Zod schema で parse すること。
//    schema mismatch 時は run-console と同じく `console.error("[ConsoleCard] payload schema mismatch", parsed.error.issues)`。
//  - parse 成功した entry のみ Props に積む。`as ConsoleEntry` cast 禁止。
//  - 詳しくは features/run-console/RunConsole.tsx の payload schema 検証経路を参照。
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  DEVELOPER_VIEW_LABELS,
  PHASE_1_2_PLACEHOLDER_LABEL,
  type ConsoleEntry,
  type LocatorRow,
  type LocatorState,
  type RunMetadataRow
} from "./types";

interface InspectorPanelProps {
  /**
   * INVARIANT (Phase 1.2 移行時):
   *  - locator.rows / consoleEntries / runMetadata は呼び出し側で loading / error / empty を分岐済の
   *    「描画する内容」を渡すこと。空配列で "障害" と "本当に空" を区別できなくなる。
   */
  locator: LocatorState;
  consoleEntries: ReadonlyArray<ConsoleEntry>;
  runMetadata: ReadonlyArray<RunMetadataRow>;
}

function PhaseBadge(): React.ReactElement {
  return <Badge variant="info">{PHASE_1_2_PLACEHOLDER_LABEL}</Badge>;
}

function LocatorCard({
  expression,
  rows
}: LocatorState): React.ReactElement {
  return (
    <Card data-testid="dev-locator-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{DEVELOPER_VIEW_LABELS.locator}</span>
          <PhaseBadge />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="mb-3 overflow-x-auto whitespace-pre rounded-md bg-[var(--bg-1)] px-3 py-2 font-mono text-xs text-[var(--ink-0)]">
          {expression}
        </pre>
        {/* dl 内では <div> でグルーピングし、各 (dt, dd) ペアを意味的に隣接させる。
            Phase 1.2 で行追加が起きても dt/dd 数の不一致で grid layout が崩れない。 */}
        <dl className="flex flex-col gap-1 text-xs">
          {rows.map((row: LocatorRow) => (
            <div
              key={row.key}
              className="grid grid-cols-[max-content_1fr] gap-x-3"
            >
              <dt className="text-[var(--ink-3)]">{row.key}</dt>
              <dd
                className={cn(
                  "font-mono",
                  row.status === "miss"
                    ? "text-[var(--fail)]"
                    : row.status === "ok"
                      ? "text-[var(--pass)]"
                      : "text-[var(--ink-1)]"
                )}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function ConsoleCard({
  entries
}: {
  entries: ReadonlyArray<ConsoleEntry>;
}): React.ReactElement {
  return (
    <Card data-testid="dev-console-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{DEVELOPER_VIEW_LABELS.console}</span>
          <PhaseBadge />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1 font-mono text-xs">
          {entries.map((entry, index) => (
            // タイムスタンプは重複し得るため index を組み合わせて key を生成する
            <li
              key={`${entry.timestamp}-${index}`}
              className="flex items-center gap-2"
            >
              <span className="w-14 shrink-0 text-[var(--ink-3)]">
                {entry.timestamp}
              </span>
              <Badge
                variant={
                  entry.level === "error"
                    ? "fail"
                    : entry.level === "warn"
                      ? "flaky"
                      : "info"
                }
                className="uppercase"
              >
                {entry.level}
              </Badge>
              <span className="truncate text-[var(--ink-1)]">{entry.message}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RunMetadataCard({
  rows
}: {
  rows: ReadonlyArray<RunMetadataRow>;
}): React.ReactElement {
  return (
    <Card data-testid="dev-run-metadata-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{DEVELOPER_VIEW_LABELS.runMetadata}</span>
          <PhaseBadge />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-1 text-xs">
          {rows.map(([key, value], index) => (
            // 同じ key (例 "Tag") が複数返る可能性に備え index も組み合わせる
            <div
              key={`${key}-${index}`}
              className="grid grid-cols-[max-content_1fr] gap-x-3"
            >
              <dt className="text-[var(--ink-3)]">{key}</dt>
              <dd className="font-mono text-[var(--ink-1)]">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * 右カラムの 3 サブカードを縦積みでまとめるパネル。
 * `data-testid="dev-inspector-panel"` で root div を pin することで、router test と
 * feature test の双方から Inspector panel の存在 / 構造を確認できる。
 */
export function InspectorPanel({
  locator,
  consoleEntries,
  runMetadata
}: InspectorPanelProps): React.ReactElement {
  return (
    <div
      data-testid="dev-inspector-panel"
      aria-label={DEVELOPER_VIEW_LABELS.inspector}
      className="flex flex-col gap-4"
    >
      <LocatorCard expression={locator.expression} rows={locator.rows} />
      <ConsoleCard entries={consoleEntries} />
      <RunMetadataCard rows={runMetadata} />
    </div>
  );
}
