// Insights View Hero: Release Readiness 表示。
//
// h1 を 1 つだけ持つ (Issue #13: heading 階層 h1 → h2 → h3 を担保)。
// Phase 1.2 で実データに切り替える際は ReleaseReadiness を `useInsightsSummary().readiness` に置換。
import * as React from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  INSIGHTS_VIEW_LABELS,
  PHASE_1_2_PLACEHOLDER_LABEL,
  type ReleaseReadiness,
  type ReleaseVerdict,
  type RunStat
} from "./types";

interface InsightsHeroProps {
  readonly readiness: ReleaseReadiness;
  readonly stats: ReadonlyArray<RunStat>;
}

const VERDICT_LABEL: Record<ReleaseVerdict, string> = {
  ready: "Ready",
  conditional: "Conditional",
  "not-ready": "Not Ready"
};

// verdict ごとに Badge variant を分岐。
// pass/fail の色相分離 (PLAN.v2 §17, oklch トークン) を維持する。
const VERDICT_BADGE_VARIANT: Record<ReleaseVerdict, BadgeProps["variant"]> = {
  ready: "pass",
  conditional: "flaky",
  "not-ready": "fail"
};

// stat label ごとの色 token。色相分離は status badge と同じルール。
const STAT_NUM_CLASS: Record<RunStat["label"], string> = {
  Total: "text-[var(--ink-0)]",
  Passed: "text-[var(--pass)]",
  Failed: "text-[var(--fail)]",
  Flaky: "text-[var(--flaky)]",
  Skipped: "text-[var(--ink-2)]"
};

export function InsightsHero({
  readiness,
  stats
}: InsightsHeroProps): React.ReactElement {
  const clampedScore = Math.max(0, Math.min(100, readiness.score));

  return (
    <Card data-testid="insights-hero" className="overflow-hidden">
      <CardContent className="flex flex-col gap-6 p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink-0)]">
              {INSIGHTS_VIEW_LABELS.hero}
            </h1>
            <Badge variant="info">{PHASE_1_2_PLACEHOLDER_LABEL}</Badge>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-semibold tabular-nums text-[var(--ink-0)]">
              {clampedScore}
            </span>
            <span className="text-base text-[var(--ink-3)]">/ 100</span>
            <Badge
              variant={VERDICT_BADGE_VARIANT[readiness.verdict]}
              data-verdict={readiness.verdict}
              className="ml-2"
            >
              {VERDICT_LABEL[readiness.verdict]}
            </Badge>
          </div>

          {/* progress bar: aria-valuenow で score を pin、視覚と同等の意味を AT に伝える */}
          <div
            role="progressbar"
            aria-label={INSIGHTS_VIEW_LABELS.hero}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clampedScore}
            className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-2)]"
          >
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
              style={{ width: `${clampedScore}%` }}
            />
          </div>

          <p className="max-w-prose text-sm text-[var(--ink-2)]">
            <span className="font-medium text-[var(--ink-1)]">{readiness.versionLabel}</span>
            <span className="mx-2 text-[var(--ink-3)]">·</span>
            {readiness.description}
          </p>
        </div>

        <dl
          aria-label="Run stats"
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:max-w-md"
        >
          {stats.map((stat) => (
            <div
              key={stat.label}
              data-stat-label={stat.label}
              className="rounded-md border border-[var(--line)] bg-[var(--bg-1)] px-3 py-2 text-center"
            >
              <dt className="text-xs text-[var(--ink-3)]">{stat.label}</dt>
              <dd
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  STAT_NUM_CLASS[stat.label]
                )}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
