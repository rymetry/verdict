// AI リリース判定 サマリ。Phase 1.2 で `POST /qmo/release-summary` の AI 出力に置換。
//
// 表示要素:
//  - h3 タイトル + AI adapter pill (Claude Code · Beta 等)
//  - 自由文 body
//  - "推奨: ..." の verdict line を 1 行 highlight
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  INSIGHTS_VIEW_LABELS,
  type AiSummary
} from "./types";

interface AiSummaryCardProps {
  readonly summary: AiSummary;
}

export function AiSummaryCard({ summary }: AiSummaryCardProps): React.ReactElement {
  return (
    <Card data-testid="insights-ai-card">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--ink-0)]">
            {INSIGHTS_VIEW_LABELS.aiSummary}
          </h3>
          <Badge variant="accent">{summary.adapterLabel}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="max-w-prose text-sm leading-relaxed text-[var(--ink-1)]">{summary.body}</p>
        <p
          data-testid="insights-ai-verdict"
          className="rounded-md border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-sm font-medium text-[var(--ink-0)]"
        >
          {summary.verdictLine}
        </p>
      </CardContent>
    </Card>
  );
}
