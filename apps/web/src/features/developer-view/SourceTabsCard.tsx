// Developer View 中央カラム: ソース / 差分 / ターミナル の 3 タブ placeholder。
//
// Phase 1.2 で接続する際の置換:
//  - source タブ: Monaco Editor (PLAN.v2 §7 Technology Stack に採用予定) で実 spec を読み込み
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
  type SourceLine
} from "./types";

interface SourceTabsCardProps {
  /**
   * INVARIANT (Phase 1.2 移行時):
   *  - loading / error / empty は呼び出し側で分岐し、Card には「描画する内容」のみ渡す。
   *  - 空配列で "障害" と "本当に空" を区別できなくなる silent failure を避ける。
   */
  source: ReadonlyArray<SourceLine>;
  diff: ReadonlyArray<SourceLine>;
  /** ターミナル出力 (1 行 = 1 配列要素) */
  terminal: ReadonlyArray<string>;
}

const TAB_VALUES = {
  source: "source",
  diff: "diff",
  terminal: "terminal"
} as const;

// state ごとの class を Record で 1 箇所にまとめ、ネスト三項を排除する (SLAP)。
const LINE_STATE_CLASS: Record<NonNullable<SourceLine["state"]> | "default", string> = {
  fail: "bg-[var(--fail-soft)] text-[var(--fail)]",
  added: "bg-[var(--pass-soft)] text-[var(--pass)]",
  removed: "bg-[var(--fail-soft)] text-[var(--fail)] line-through",
  default: "text-[var(--ink-1)]"
};

function renderLine(line: SourceLine, index: number): React.ReactElement {
  const stateKey = line.state ?? "default";
  return (
    <div
      // 行番号 + index で組成: SAMPLE_DIFF で `+` / `-` が複数出現する diff 用に index を含める
      key={`${line.lineNo}-${index}`}
      // 状態を data 属性で expose することで、test は class 文字列に結合せず data-line-state を assert できる
      data-line-state={stateKey}
      className={cn(
        "flex gap-3 rounded-sm px-2 py-0.5 font-mono text-xs",
        LINE_STATE_CLASS[stateKey]
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
  source,
  diff,
  terminal
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
