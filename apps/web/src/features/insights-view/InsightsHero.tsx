// Insights View Hero: Release Readiness 表示。
//
// heading 階層 (Issue #13 受け入れ条件 \"h1 (Chrome) → h2 (Insights main) → h3 (cards)\"):
//  - h1 は Chrome (TopBar の Brand 内 "Playwright Workbench") が持つ。
//  - 本 Hero は main 直下の h2 (= Insights view の entry heading) として "Release Readiness" を表示。
//  - 各 card (重大な失敗 / 既知の問題 / Top Flaky / AI / Quality Gate / Allure / Recent runs) は h3。
// Phase 1.2 で実データに切り替える際は ReleaseReadiness を `useInsightsSummary().readiness` に置換。
import * as React from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import {
  INSIGHTS_VIEW_LABELS,
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

// verdict ごとに Badge variant を分岐。pass / flaky / fail の色相分離は
// docs/design/concept-b-refined.html (Balanced Green tokens) の方針を踏襲。
const VERDICT_BADGE_VARIANT: Record<ReleaseVerdict, BadgeProps["variant"]> = {
  ready: "pass",
  conditional: "flaky",
  "not-ready": "fail"
};

// stat label ごとの色 token。色相分離 (pass=142° / fail=27° / flaky=80°) は色覚 only に
// 依存しないアクセシビリティ原則に基づく (docs/design/concept-b-refined.html, Balanced Green tokens)。
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
  // NaN / Infinity から UI を守る (silent failure 防衛: aria-valuenow="NaN" や width: NaN%
  // で progress bar が壊れるのを防ぎ、Phase 1.2 で API/AI が finite でない値を返した場合に
  // 0 で扱われた事実を console.error で残す)。
  const rawScore = readiness.score;
  if (!Number.isFinite(rawScore)) {
    // eslint-disable-next-line no-console -- score 異常を本番でも痕跡を残す (Phase 1.2 早期検出)
    console.error("[InsightsHero] readiness.score is not a finite number", rawScore);
  }
  const safeScore = Number.isFinite(rawScore) ? rawScore : 0;
  const clampedScore = Math.max(0, Math.min(100, safeScore));

  return (
    <Card data-testid="insights-hero" className="overflow-hidden">
      <CardContent className="flex flex-col gap-6 p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--ink-0)]">
              {INSIGHTS_VIEW_LABELS.hero}
            </h2>
            {/* §1.2 で readiness/score/verdict が実データに wire 済。
                旧 placeholder badge は除去 (UI が mock であるかのような誤解を防止)。 */}
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

          {/* progress bar: aria-valuenow で score を pin、視覚と同等の意味を AT に伝える。
              aria-label は h2 と区別するため "score" suffix を付け、AT 上で重複読み上げを避ける。 */}
          <div
            role="progressbar"
            aria-label={`${INSIGHTS_VIEW_LABELS.hero} score`}
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
