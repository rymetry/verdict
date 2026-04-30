// Insights View Main: 重大な失敗 / 既知の問題 / Top Flaky の 3 card row。
//
// 共通構造:
//  - h3 タイトル (heading 階層 h1 → h2 (main aria-label="Insights main") → h3 (cards) を維持)
//  - count バッジ
//  - "すべて表示" は dead link を作らないため Phase 1.2 接続予定 Tooltip 付きの disabled button
//  - 一覧は 3 件まで (Phase 1 placeholder。Phase 1.2 で polling/pagination 化)
//
// 設計判断 (Issue #13 受け入れ条件):
//  - Issue は \"disabled button + tooltip 'Phase 1.2 で接続予定'\" を要求 → shadcn Tooltip 経由で配線
//  - reading order は h3 → count → Phase 1.2 badge → disabled button (内容 → 状態通知 → action)
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import {
  DEFERRED_PLACEHOLDER_LABEL,
  INSIGHTS_VIEW_LABELS,
  type FailureItem,
  type FlakyItem,
  type KnownIssue
} from "./types";

interface MainCardsRowProps {
  readonly criticalFailures: ReadonlyArray<FailureItem>;
  readonly knownIssues: ReadonlyArray<KnownIssue>;
  readonly topFlaky: ReadonlyArray<FlakyItem>;
}

/**
 * "すべて表示" disabled button + tooltip。
 * Issue #13 で dead link 禁止が明示されているため、href を持つ <a> ではなく
 * disabled button + Tooltip でユーザに「Phase 1.2 で接続予定」と伝える。
 *
 * 注意: <button disabled> は pointer events を発火しないため、Radix Tooltip の
 * `asChild` Trigger に直接渡しても hover/focus を検知できない。focusable な wrapper
 * `<span tabIndex={0}>` で囲む既知のワークアラウンドを用いる
 * (radix-ui/primitives で議論されているコミュニティ標準対応)。
 */
function ShowAllPlaceholder({ id }: { id: string }): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>
          <Button
            variant="ghost"
            size="sm"
            disabled
            data-testid={id}
            aria-describedby={`${id}-tooltip`}
          >
            {INSIGHTS_VIEW_LABELS.showAll} ›
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent id={`${id}-tooltip`}>{DEFERRED_PLACEHOLDER_LABEL}</TooltipContent>
    </Tooltip>
  );
}

interface ListCardProps {
  readonly testId: string;
  readonly title: string;
  readonly count: number;
  /**
   * 一覧 1 件分を render する子要素。caller 側で li の子要素を組み立てる
   * (型ごとに表示形が違うため共通 row component にせず caller 側に寄せる)。
   */
  readonly children: React.ReactNode;
  readonly showAllId: string;
  /**
   * §1.2: 該当 card のデータが実データに wire 済か。
   * - `true`: badge を表示しない (Critical Failures は §1.2 で wire 済)
   * - `false`/未指定: 既存通り "Phase 5+ で接続予定" badge を表示
   *   (Known Issues / Top Flaky は Phase 5+ で接続予定)。
   */
  readonly connected?: boolean;
}

function ListCard({
  testId,
  title,
  count,
  children,
  showAllId,
  connected = false
}: ListCardProps): React.ReactElement {
  return (
    <Card data-testid={testId} className="flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--ink-0)]">{title}</h3>
          <Badge variant="outline">{count}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {connected ? null : (
            <Badge variant="info">{DEFERRED_PLACEHOLDER_LABEL}</Badge>
          )}
          <ShowAllPlaceholder id={showAllId} />
        </div>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-[var(--line)]">{children}</ul>
      </CardContent>
    </Card>
  );
}

function FailureRow({ item }: { item: FailureItem }): React.ReactElement {
  return (
    <li className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
      <span className="text-sm text-[var(--ink-1)]">
        <span className="text-[var(--ink-3)]">{item.scope} ›</span>{" "}
        <span className="text-[var(--ink-0)]">{item.title}</span>
      </span>
      <span className="font-mono text-xs text-[var(--ink-3)]">{item.meta}</span>
    </li>
  );
}

function KnownIssueRow({ item }: { item: KnownIssue }): React.ReactElement {
  return (
    <li className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
      <span className="text-sm text-[var(--ink-0)]">{item.title}</span>
      <span className="font-mono text-xs text-[var(--ink-3)]">{item.meta}</span>
    </li>
  );
}

function FlakyRow({ item }: { item: FlakyItem }): React.ReactElement {
  return (
    <li className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
      <span className="text-sm text-[var(--ink-1)]">
        <span className="text-[var(--ink-3)]">{item.scope} ›</span>{" "}
        <span className="text-[var(--ink-0)]">{item.title}</span>
      </span>
      <span className="font-mono text-xs text-[var(--ink-3)]">{item.meta}</span>
    </li>
  );
}

export function MainCardsRow({
  criticalFailures,
  knownIssues,
  topFlaky
}: MainCardsRowProps): React.ReactElement {
  return (
    <div
      data-testid="insights-main-cards"
      className="grid grid-cols-1 gap-4 lg:grid-cols-3"
    >
      <ListCard
        testId="insights-critical-card"
        title={INSIGHTS_VIEW_LABELS.criticalFailures}
        count={criticalFailures.length}
        showAllId="insights-critical-show-all"
        // §1.2 で QmoSummary.testSummary.failedTests に wire 済。
        connected
      >
        {criticalFailures.map((item) => (
          <FailureRow key={item.id} item={item} />
        ))}
      </ListCard>

      <ListCard
        testId="insights-known-card"
        title={INSIGHTS_VIEW_LABELS.knownIssues}
        count={knownIssues.length}
        showAllId="insights-known-show-all"
      >
        {knownIssues.map((item) => (
          <KnownIssueRow key={item.id} item={item} />
        ))}
      </ListCard>

      <ListCard
        testId="insights-flaky-card"
        title={INSIGHTS_VIEW_LABELS.topFlaky}
        count={topFlaky.length}
        showAllId="insights-flaky-show-all"
      >
        {topFlaky.map((item) => (
          <FlakyRow key={item.id} item={item} />
        ))}
      </ListCard>
    </div>
  );
}
