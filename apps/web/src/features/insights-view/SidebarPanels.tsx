// Insights View 右サイド: Quality Gate / Allure サマリ / 最近の Run の 3 panel。
//
// Phase 1.2 接続点:
//  - Quality Gate: GET /runs/:runId/quality-gate (PLAN.v2 §19, §23) — exitCode + raw stdout から structured rules
//  - Allure サマリ: AllureReportProvider 経由で 30 日 trend
//  - 最近の Run: GET /runs (history endpoint) — 5 件先頭
//
// "フルレポート ›" は Allure HTML への外部 link 想定だが Phase 1 では URL 未確定 →
// disabled button + Tooltip "Phase 1.2 で接続予定" で dead link を避ける (Issue #13 受け入れ条件)。
import * as React from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  INSIGHTS_VIEW_LABELS,
  DEFERRED_PLACEHOLDER_LABEL,
  type AllureSummaryRow,
  type QualityGateRule,
  type RecentRun
} from "./types";

interface SidebarPanelsProps {
  readonly qualityGate: ReadonlyArray<QualityGateRule>;
  readonly allureSummary: ReadonlyArray<AllureSummaryRow>;
  readonly recentRuns: ReadonlyArray<RecentRun>;
}

const RUN_STATUS_VARIANT: Record<RecentRun["status"], BadgeProps["variant"]> = {
  passed: "pass",
  failed: "fail",
  flaky: "flaky"
};

const RUN_STATUS_LABEL: Record<RecentRun["status"], string> = {
  passed: "Passed",
  failed: "Failed",
  flaky: "Flaky"
};

const TREND_ICON: Record<RecentRun["trend"], React.ReactElement> = {
  up: <ArrowUp aria-hidden="true" className="h-3 w-3 text-[var(--pass)]" />,
  down: <ArrowDown aria-hidden="true" className="h-3 w-3 text-[var(--fail)]" />,
  flat: <Minus aria-hidden="true" className="h-3 w-3 text-[var(--ink-3)]" />
};

const TREND_LABEL: Record<RecentRun["trend"], string> = {
  up: "上昇",
  down: "下降",
  flat: "横ばい"
};

/**
 * Quality Gate / Allure サマリ共通の rule row 表示。
 * `data-rule-status` で pass / fail を expose し、test を class 文字列に couple させない。
 */
function RuleRow({
  name,
  thresholdLabel,
  actual,
  status
}: {
  name: string;
  thresholdLabel: string;
  actual: string;
  status: "pass" | "fail";
}): React.ReactElement {
  return (
    <div
      data-rule-status={status}
      className="grid grid-cols-[1fr_auto_auto] items-baseline gap-2 px-3 py-2 text-xs"
    >
      <span className="text-[var(--ink-1)]">{name}</span>
      <span className="font-mono text-[var(--ink-3)]">{thresholdLabel}</span>
      <span
        className={cn(
          "font-mono font-semibold tabular-nums",
          status === "pass" ? "text-[var(--pass)]" : "text-[var(--fail)]"
        )}
      >
        {actual}
      </span>
    </div>
  );
}

function QualityGateCard({
  rules
}: {
  rules: ReadonlyArray<QualityGateRule>;
}): React.ReactElement {
  // 全 rule pass なら "Passed" バッジを点ける。Phase 1.2 で部分 pass を扱うときに見直す。
  const allPass = rules.every((rule) => rule.status === "pass");
  return (
    <Card data-testid="insights-quality-gate-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--ink-0)]">
            {INSIGHTS_VIEW_LABELS.qualityGate}
          </h3>
          <Badge variant={allPass ? "pass" : "fail"}>{allPass ? "Passed" : "Failed"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <div className="divide-y divide-[var(--line)]">
          {rules.map((rule) => (
            <RuleRow
              key={rule.name}
              name={rule.name}
              thresholdLabel={rule.threshold}
              actual={rule.actual}
              status={rule.status}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AllureSummaryPanel({
  rows
}: {
  rows: ReadonlyArray<AllureSummaryRow>;
}): React.ReactElement {
  return (
    <Card data-testid="insights-allure-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--ink-0)]">
            {INSIGHTS_VIEW_LABELS.allureSummary}
          </h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled
                  data-testid="insights-allure-full-report"
                  aria-describedby="insights-allure-full-report-tooltip"
                >
                  {INSIGHTS_VIEW_LABELS.fullReport} ›
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent id="insights-allure-full-report-tooltip">
              {DEFERRED_PLACEHOLDER_LABEL}
            </TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <div className="divide-y divide-[var(--line)]">
          {rows.map((row) => (
            <RuleRow
              key={row.name}
              name={row.name}
              thresholdLabel={row.previous}
              actual={row.actual}
              status={row.status}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RecentRunsPanel({
  runs
}: {
  runs: ReadonlyArray<RecentRun>;
}): React.ReactElement {
  return (
    <Card data-testid="insights-recent-runs-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--ink-0)]">
            {INSIGHTS_VIEW_LABELS.recentRuns}
          </h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled
                  data-testid="insights-recent-runs-show-all"
                  aria-describedby="insights-recent-runs-show-all-tooltip"
                >
                  {INSIGHTS_VIEW_LABELS.showAll} ›
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent id="insights-recent-runs-show-all-tooltip">
              {DEFERRED_PLACEHOLDER_LABEL}
            </TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-[var(--line)]">
          {runs.map((run) => (
            <li
              key={run.id}
              data-run-status={run.status}
              data-run-trend={run.trend}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-2 py-2 text-xs first:pt-0 last:pb-0"
            >
              <span className="font-mono text-[var(--ink-2)]">{run.timestamp}</span>
              <Badge variant={RUN_STATUS_VARIANT[run.status]}>
                {RUN_STATUS_LABEL[run.status]}
              </Badge>
              <span className="flex items-center gap-1 font-mono tabular-nums text-[var(--ink-1)]">
                {/* trend icon は装飾。意味は run.trend 属性で AT に伝える */}
                <span className="sr-only">{TREND_LABEL[run.trend]}</span>
                {TREND_ICON[run.trend]}
                {run.passRate}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function SidebarPanels({
  qualityGate,
  allureSummary,
  recentRuns
}: SidebarPanelsProps): React.ReactElement {
  return (
    <aside
      aria-label="Insights サイドバー"
      data-testid="insights-sidebar"
      className="flex flex-col gap-4"
    >
      <QualityGateCard rules={qualityGate} />
      <AllureSummaryPanel rows={allureSummary} />
      <RecentRunsPanel runs={recentRuns} />
    </aside>
  );
}
