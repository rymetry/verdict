// Live QMO Release Readiness Summary banner (Phase 1.2 / T208-2).
//
// 設計:
//  - 既存 InsightsView (placeholder) には触らない。本 banner は **above the fold** に
//    real data 1 行を表示し、placeholder と並走する形で Phase 1.2 の lifecycle
//    (T200-T207) が actual に動いていることを目視確認できるようにする。
//  - Phase 1.2 後段で InsightsView 全体を `useInsightsSummary()` 駆動に置き換える時、
//    本 banner は QmoSummary → InsightsSummary mapping の reference 実装になる。
//
// rendering states:
//  - loading: 何も表示しない (banner は補助情報なので空 placeholder が誠実)
//  - 409 NO_QMO_SUMMARY (data === null): "QMO summary not yet generated" バッジ
//  - error: "QMO summary unavailable" + console.error (hook 側で出力済み)
//  - 200: outcome badge (ready/conditional/not-ready) + test counts + QG status

import * as React from "react";
import type { QmoSummary } from "@pwqa/shared";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * outcome → badge variant + display label の mapping。design system の既存 variant
 * (`pass` / `flaky` / `fail`) を再利用し、テスト結果 badge と色相整合させる。
 * 配列 lookup ではなく switch で書くことで TypeScript exhaustiveness check を効かせる。
 */
function outcomeBadgeProps(outcome: QmoSummary["outcome"]): {
  variant: "pass" | "flaky" | "fail";
  label: string;
} {
  switch (outcome) {
    case "ready":
      return { variant: "pass", label: "Ready" };
    case "conditional":
      return { variant: "flaky", label: "Conditional" };
    case "not-ready":
      return { variant: "fail", label: "Not Ready" };
    default: {
      // Exhaustiveness check: future outcome additions surface as compile error.
      const _exhaustive: never = outcome;
      void _exhaustive;
      return { variant: "flaky", label: String(outcome) };
    }
  }
}

interface QmoSummaryBannerProps {
  /** `useQmoSummaryQuery` の戻り値。
   *  - `summary === undefined`: loading (まだ fetch していない)
   *  - `summary === null`: 409 NO_QMO_SUMMARY (生成待ち / Allure 未設定)
   *  - `summary === QmoSummary`: 取得成功
   */
  readonly summary: QmoSummary | null | undefined;
  /** True when the hook reports an error (non-409). */
  readonly isError: boolean;
  /**
   * True when the runs list resolved successfully but contained zero
   * runs (project just opened, no run yet executed). Distinguished from
   * the generic loading / not-yet-generated states so the operator
   * sees a clear "Run a test to populate this view" message instead of
   * an indefinite spinner. T208-2 review fix (PR #49).
   */
  readonly isEmpty: boolean;
}

export function QmoSummaryBanner(props: QmoSummaryBannerProps): React.ReactElement | null {
  const body = renderBody(props);
  if (body === null) return null;
  return (
    <Card data-testid="qmo-summary-banner" aria-label="QMO Release Readiness Summary">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">QMO Release Readiness</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">{body}</CardContent>
    </Card>
  );
}

/**
 * State → React node mapping. Extracted so each branch can narrow the
 * `summary` type independently without TS losing the narrowing across
 * a ternary nest. Returns `null` for the loading state — the parent
 * suppresses the entire Card so layout does not shift while waiting.
 */
function renderBody(props: QmoSummaryBannerProps): React.ReactElement | null {
  const { summary, isError, isEmpty } = props;
  if (isError) {
    return (
      <span data-testid="qmo-summary-banner-error" className="text-destructive">
        QMO summary unavailable
      </span>
    );
  }
  // Empty-project state takes precedence over the generic loading branch.
  // Without this, an empty runs list would leave the banner stuck in
  // the loading=null branch indefinitely, indistinguishable from "still
  // fetching" (T208-2 review fix / PR #49).
  if (isEmpty) {
    return (
      <span data-testid="qmo-summary-banner-no-runs" className="text-muted-foreground">
        No runs yet. Trigger a test run to populate this summary.
      </span>
    );
  }
  if (summary === undefined) {
    return null;
  }
  if (summary === null) {
    return (
      <span data-testid="qmo-summary-banner-empty" className="text-muted-foreground">
        QMO summary not yet generated for this run.
      </span>
    );
  }
  return <QmoSummaryBannerLoaded summary={summary} />;
}

function QmoSummaryBannerLoaded({ summary }: { summary: QmoSummary }): React.ReactElement {
  const outcome = outcomeBadgeProps(summary.outcome);
  const t = summary.testSummary;
  const qg = summary.qualityGate;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Badge data-testid="qmo-summary-banner-outcome" variant={outcome.variant}>
        {outcome.label}
      </Badge>
      {t && (
        <span data-testid="qmo-summary-banner-tests" className="font-mono text-xs">
          tests: {t.passed}/{t.total} pass
          {t.failed > 0 ? ` · ${t.failed} fail` : ""}
          {t.skipped > 0 ? ` · ${t.skipped} skip` : ""}
        </span>
      )}
      {qg && (
        <span data-testid="qmo-summary-banner-qg" className="font-mono text-xs">
          QG: {qualityGateDisplay(qg)}
        </span>
      )}
      {summary.runDurationMs !== undefined && (
        <span data-testid="qmo-summary-banner-duration" className="font-mono text-xs text-muted-foreground">
          {Math.round(summary.runDurationMs / 1000)}s
        </span>
      )}
      {summary.reportLinks.allureReportDir && (
        <a
          data-testid="qmo-summary-banner-allure-report-link"
          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          href={toFileHref(`${summary.reportLinks.allureReportDir}/index.html`)}
          target="_blank"
          rel="noreferrer"
        >
          Allure report
        </a>
      )}
      {summary.reportLinks.qualityGateResultPath && (
        <a
          data-testid="qmo-summary-banner-quality-gate-link"
          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          href={toFileHref(summary.reportLinks.qualityGateResultPath)}
          target="_blank"
          rel="noreferrer"
        >
          Quality Gate JSON
        </a>
      )}
    </div>
  );
}

function qualityGateDisplay(qg: NonNullable<QmoSummary["qualityGate"]>): string {
  if (qg.enforcement === "advisory") {
    return `evaluated · advisory (${qg.profile})`;
  }
  return `${qg.status} (${qg.profile})`;
}

function toFileHref(filePath: string): string {
  const normalized = filePath.startsWith("/") ? filePath : `/${filePath}`;
  return `file://${normalized.split("/").map(encodeURIComponent).join("/")}`;
}
