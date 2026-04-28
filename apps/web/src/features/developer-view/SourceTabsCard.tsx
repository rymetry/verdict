// Developer View 中央カラム: ソース / 差分 / ターミナル の 3 タブ placeholder。
//
// Phase 1.2 で接続する際の置換:
//  - source タブ: Monaco Editor (PLAN.v2 §17 の design system 一覧で予定済) で実 spec を読み込み
//  - diff タブ: simple-git の diff stream → diff renderer
//  - terminal タブ: xterm.js + WebSocket `run.stdout/stderr` ストリーム
// 本 placeholder は静的 HTML で構造のみ pin し、上記置換時の差分を最小化する。
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  DEVELOPER_VIEW_LABELS,
  PHASE_1_2_PLACEHOLDER_LABEL,
  SAMPLE_DIFF,
  SAMPLE_SOURCE,
  SAMPLE_TERMINAL,
  type SourceLine
} from "./sample-data";

interface SourceTabsCardProps {
  source?: ReadonlyArray<SourceLine>;
  diff?: ReadonlyArray<SourceLine>;
  /** ターミナル出力 (1 行 = 1 配列要素) */
  terminal?: ReadonlyArray<string>;
}

const TAB_VALUES = {
  source: "source",
  diff: "diff",
  terminal: "terminal"
} as const;

function renderLine(line: SourceLine, index: number): React.ReactElement {
  const stateClass =
    line.state === "fail"
      ? "bg-[var(--fail-soft)] text-[var(--fail)]"
      : line.state === "added"
        ? "bg-[var(--pass-soft)] text-[var(--pass)]"
        : line.state === "removed"
          ? "bg-[var(--fail-soft)] text-[var(--fail)] line-through"
          : "text-[var(--ink-1)]";

  return (
    <div
      // 行番号 + index で組成: 同一行番号 ('-' / '+') が複数出現する diff 用に index をキーに含める
      key={`${line.lineNo}-${index}`}
      className={cn(
        "flex gap-3 rounded-sm px-2 py-0.5 font-mono text-xs",
        stateClass
      )}
    >
      <span
        className="w-6 shrink-0 select-none text-right text-[var(--ink-3)]"
        aria-hidden="true"
      >
        {line.lineNo}
      </span>
      <span className="whitespace-pre">{line.text}</span>
    </div>
  );
}

export function SourceTabsCard({
  source = SAMPLE_SOURCE,
  diff = SAMPLE_DIFF,
  terminal = SAMPLE_TERMINAL
}: SourceTabsCardProps): React.ReactElement {
  return (
    <Card data-testid="dev-source-tabs-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{DEVELOPER_VIEW_LABELS.sourceTabs}</span>
          <Badge variant="info">{PHASE_1_2_PLACEHOLDER_LABEL}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={TAB_VALUES.source} className="w-full">
          <TabsList>
            <TabsTrigger value={TAB_VALUES.source}>
              {DEVELOPER_VIEW_LABELS.source}
            </TabsTrigger>
            <TabsTrigger value={TAB_VALUES.diff}>
              {DEVELOPER_VIEW_LABELS.diff}
            </TabsTrigger>
            <TabsTrigger value={TAB_VALUES.terminal}>
              {DEVELOPER_VIEW_LABELS.terminal}
            </TabsTrigger>
          </TabsList>
          <TabsContent value={TAB_VALUES.source}>
            <div
              role="region"
              aria-label={DEVELOPER_VIEW_LABELS.source}
              className="rounded-md border border-[var(--line)] bg-[var(--bg-1)] p-2"
            >
              {source.map(renderLine)}
            </div>
          </TabsContent>
          <TabsContent value={TAB_VALUES.diff}>
            <div
              role="region"
              aria-label={DEVELOPER_VIEW_LABELS.diff}
              className="rounded-md border border-[var(--line)] bg-[var(--bg-1)] p-2"
            >
              {diff.map(renderLine)}
            </div>
          </TabsContent>
          <TabsContent value={TAB_VALUES.terminal}>
            <pre
              role="region"
              aria-label={DEVELOPER_VIEW_LABELS.terminal}
              className="overflow-x-auto whitespace-pre rounded-md border border-[var(--line)] bg-[var(--bg-0)] p-3 font-mono text-xs text-[var(--ink-1)]"
            >
              {terminal.join("\n")}
            </pre>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
