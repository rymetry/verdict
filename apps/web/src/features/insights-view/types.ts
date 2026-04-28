// Insights View で使う型 + Phase 1.2 接続予定 label。
//
// 設計:
//  - ε と同じパターン (production code 側に型 + label 定数のみ。MOCK_DATA は placeholder-data.ts に隔離)。
//  - Phase 1.2 で `useInsightsSummary()` hook が `GET /runs/:id/report-summary` を叩いて
//    AllureReportProvider (PLAN.v2 §16) 経由で実データを返すように切り替える。
//  - 各 Card Props は required (= silent fallback を構造的に許さない)。
//
// Phase 1.2 で実データ接続する際の置換ポイント:
//  - InsightsHero: GET /runs/:runId/report-summary の release readiness 指標
//  - CriticalFailures / KnownIssues / TopFlaky: AllureReportProvider 経由 + known-issues.json
//  - AiSummary: POST /qmo/release-summary (PLAN.v2 §19) で AI 出力を取得
//  - QualityGate: GET /runs/:runId/quality-gate (PLAN.v2 §19, §23)
//  - AllureSummary: AllureReportProvider の history / 30 日 trend
//  - RecentRuns: GET /runs (history endpoint)

export type ReleaseVerdict = "ready" | "conditional" | "not-ready";

export interface ReleaseReadiness {
  /** 0〜100 の score。Phase 1.2 で release readiness algorithm が確定したら表現を見直す */
  readonly score: number;
  readonly verdict: ReleaseVerdict;
  readonly versionLabel: string;
  /** Hero 説明文 (Phase 1.2 で AI / static 切替) */
  readonly description: string;
}

/**
 * Hero の 5 stats (Total / Passed / Failed / Flaky / Skipped)。
 * 配列で順序を pin。Phase 1.2 で項目追加が起きてもこの型を拡張する。
 */
export interface RunStat {
  readonly label: "Total" | "Passed" | "Failed" | "Flaky" | "Skipped";
  readonly value: string;
}

/**
 * 重大な失敗 row。Critical な test 失敗 1 件分の表示単位。
 */
export interface FailureItem {
  readonly id: string;
  readonly scope: string;
  readonly title: string;
  /** "tests/e2e/checkout.spec.ts:112 · chromium · 3m ago" のような複合メタ表示 */
  readonly meta: string;
}

/**
 * 既知の問題 row。Issue tracker (Linear / GitHub Issues) からの抽出を想定。
 */
export interface KnownIssue {
  readonly id: string;
  readonly title: string;
  /** "#1024 · Open · High" 形式 */
  readonly meta: string;
}

/**
 * Top Flaky row。flaky rate を併記する。
 */
export interface FlakyItem {
  readonly id: string;
  readonly scope: string;
  readonly title: string;
  readonly meta: string;
}

/**
 * Quality Gate rule 1 行。`status` で pass / fail を識別 (Allure CLI exit code に対応する想定)。
 */
export interface QualityGateRule {
  readonly name: string;
  readonly threshold: string;
  readonly actual: string;
  readonly status: "pass" | "fail";
}

/**
 * Allure サマリ rule 1 行 (Quality Gate と同じ shape だが意味は trend なので別 type で意図分離)。
 */
export interface AllureSummaryRow {
  readonly name: string;
  /** "前回 82.1%" のような prev 値表示 */
  readonly previous: string;
  readonly actual: string;
  readonly status: "pass" | "fail";
}

/**
 * 最近の Run 1 行。trend は前回比較 ("up" / "down" / "flat")。
 */
export interface RecentRun {
  readonly id: string;
  /** "2024/05/18 10:24" のような日時表示 */
  readonly timestamp: string;
  readonly status: "passed" | "failed" | "flaky";
  readonly passRate: string;
  readonly trend: "up" | "down" | "flat";
}

/**
 * AI Release Readiness Summary (Claude Code 出力)。
 * Phase 1.2 で `POST /qmo/release-summary` の response shape と一致させる。
 */
export interface AiSummary {
  /** "Claude Code · Beta" のような adapter 表示 */
  readonly adapterLabel: string;
  /** 自由文 (AI 出力本文) */
  readonly body: string;
  /** "推奨: 本番昇格可能。..." の verdict 1 行 */
  readonly verdictLine: string;
}

/**
 * InsightsView 全体の集約型。Phase 1.2 では `useInsightsSummary()` hook が
 * この shape を返す前提で route 側の構造を維持する。
 */
export interface InsightsSummary {
  readonly readiness: ReleaseReadiness;
  readonly stats: ReadonlyArray<RunStat>;
  readonly criticalFailures: ReadonlyArray<FailureItem>;
  readonly knownIssues: ReadonlyArray<KnownIssue>;
  readonly topFlaky: ReadonlyArray<FlakyItem>;
  readonly ai: AiSummary;
  readonly qualityGate: ReadonlyArray<QualityGateRule>;
  readonly allureSummary: ReadonlyArray<AllureSummaryRow>;
  readonly recentRuns: ReadonlyArray<RecentRun>;
}

/**
 * Phase 1.2 接続予定 badge / tooltip の文言。
 * 全 placeholder badge を Phase 1.2 で外したことを grep で確認するための定数。
 * Phase 1.2 で sample data を削除する際もこの const は最後まで残す。
 */
export const PHASE_1_2_PLACEHOLDER_LABEL = "Phase 1.2 で接続予定";

/**
 * Insights View の UI 文言。Card title など複数箇所から参照される文字列を集約し、
 * 文言変更時の grep 起点とする。
 */
export const INSIGHTS_VIEW_LABELS = {
  hero: "Release Readiness",
  criticalFailures: "重大な失敗",
  knownIssues: "既知の問題",
  topFlaky: "Top Flaky",
  aiSummary: "AI リリース判定 サマリ",
  qualityGate: "Quality Gate",
  allureSummary: "Allure サマリ",
  recentRuns: "最近の Run",
  showAll: "すべて表示",
  fullReport: "フルレポート"
} as const;

export type InsightsViewLabel = keyof typeof INSIGHTS_VIEW_LABELS;
