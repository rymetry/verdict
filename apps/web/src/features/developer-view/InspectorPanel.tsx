// Developer View 右カラム: Locator / Console / Run metadata の 3 サブカード placeholder。
//
// Phase 1.2 で接続する際の置換:
//  - Locator: ts-morph (Phase 5/7) ベースの解析 or `playwright test --debug` 出力 + locator inspect
//  - Console: WebSocket `run.stdout/stderr` ストリームから `[browser-console]` 行を抽出
//  - Run metadata: GET /runs/:runId の response (既存 endpoint)
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  DEVELOPER_VIEW_LABELS,
  PHASE_1_2_PLACEHOLDER_LABEL,
  SAMPLE_CONSOLE,
  SAMPLE_LOCATOR,
  SAMPLE_RUN_METADATA,
  type ConsoleEntry,
  type LocatorRow
} from "./sample-data";

interface InspectorPanelProps {
  locator?: {
    expression: string;
    rows: ReadonlyArray<LocatorRow>;
  };
  consoleEntries?: ReadonlyArray<ConsoleEntry>;
  runMetadata?: ReadonlyArray<readonly [string, string]>;
}

function PhaseBadge(): React.ReactElement {
  return <Badge variant="info">{PHASE_1_2_PLACEHOLDER_LABEL}</Badge>;
}

function LocatorCard({
  expression,
  rows
}: {
  expression: string;
  rows: ReadonlyArray<LocatorRow>;
}): React.ReactElement {
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
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map((row) => (
            <React.Fragment key={row.key}>
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
            </React.Fragment>
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
  rows: ReadonlyArray<readonly [string, string]>;
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
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
          {rows.map(([key, value]) => (
            <React.Fragment key={key}>
              <dt className="text-[var(--ink-3)]">{key}</dt>
              <dd className="font-mono text-[var(--ink-1)]">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * 右カラムの 3 サブカードをまとめる縦積みパネル。
 * `data-testid="dev-inspector-panel"` をルート div に付与し、レイアウト崩れの regression を確認しやすくする。
 */
export function InspectorPanel({
  locator = SAMPLE_LOCATOR,
  consoleEntries = SAMPLE_CONSOLE,
  runMetadata = SAMPLE_RUN_METADATA
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
