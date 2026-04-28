// Insights View Phase 1 placeholder の静的サンプルデータ。
//
// **Phase 1.2 で削除されること** (silent failure 防衛):
//  - 全 Card の Props は required (default fallback なし)。本データは route component
//    (`apps/web/src/routes/qmo.tsx`) からのみ import される。
//  - Phase 1.2 で `useInsightsSummary()` hook (TanStack Query 5 秒 polling) に切り替える際は
//    本ファイルの import を qmo.tsx から削除し、hook の戻り値を直接 props に渡す。
//    各 Card Props が required のため `data ?? MOCK_*` のような silent fallback は構造上書けない。
//  - 全 SAMPLE_* export と本ファイル自身を Phase 1.2 で削除すること。`PHASE_1_2_PLACEHOLDER_LABEL`
//    定数 (types.ts) は最後まで残し、grep で全 placeholder badge が外れたか確認に使う。
//
// 参考: ε (Issue #12) と同じ pattern を踏襲。詳細は
// `apps/web/src/features/developer-view/placeholder-data.ts` のコメント参照。
import type { InsightsSummary } from "./types";

export const SAMPLE_INSIGHTS: InsightsSummary = {
  readiness: {
    score: 86,
    verdict: "ready",
    versionLabel: "v2.14.0-rc",
    description:
      "全 6 つの Quality Gate ルールをパス。重大な失敗 3 件と Flaky 3 件を確認すれば本番昇格可。"
  },
  stats: [
    { label: "Total", value: "2,842" },
    { label: "Passed", value: "2,486" },
    { label: "Failed", value: "198" },
    { label: "Flaky", value: "37" },
    { label: "Skipped", value: "121" }
  ],
  criticalFailures: [
    {
      id: "f1",
      scope: "checkout",
      title: "should complete payment",
      meta: "tests/e2e/checkout.spec.ts:112 · chromium · 3m ago"
    },
    {
      id: "f2",
      scope: "search",
      title: "filters › price range",
      meta: "tests/e2e/search/filters.spec.ts:78 · webkit · 12m ago"
    },
    {
      id: "f3",
      scope: "profile",
      title: "update › saves changes",
      meta: "tests/e2e/profile/update.spec.ts:54 · firefox · 16m ago"
    }
  ],
  knownIssues: [
    {
      id: "i1024",
      title: "Payment gateway timeout in CI",
      meta: "#1024 · Open · High"
    },
    {
      id: "i987",
      title: "Flaky: product list virtual scroll",
      meta: "#987 · Open · Medium"
    },
    {
      id: "i956",
      title: "Intermittent auth redirect",
      meta: "#956 · Open · Medium"
    }
  ],
  topFlaky: [
    {
      id: "t1",
      scope: "search",
      title: "autocomplete suggestions",
      meta: "tests/e2e/search.auto.spec.ts:23 · 24%"
    },
    {
      id: "t2",
      scope: "cart",
      title: "remove item",
      meta: "tests/e2e/cart.remove.spec.ts:41 · 18%"
    },
    {
      id: "t3",
      scope: "homepage",
      title: "hero carousel",
      meta: "tests/e2e/home.hero.spec.ts:17 · 15%"
    }
  ],
  ai: {
    adapterLabel: "Claude Code · Beta",
    body:
      "総合品質は良好で、前回比でパス率が +6.1pp 改善。リスクは checkout / search の 3 件の重大な失敗に集中。" +
      "Flaky リスクは許容範囲内 (7.2%) ですが、上位 3 件は次回 sprint で対処推奨。" +
      "前回ブロッカー (#1024 Payment gateway timeout) は新規発生していません。",
    verdictLine: "推奨: 本番昇格可能。重大な失敗 3 件を確認後、デプロイ可。"
  },
  qualityGate: [
    { name: "最低パス率", threshold: "≥ 85%", actual: "88.2%", status: "pass" },
    { name: "最大失敗数", threshold: "≤ 200", actual: "198", status: "pass" },
    { name: "重大な失敗", threshold: "= 0", actual: "0", status: "pass" },
    { name: "Flaky リスク上限", threshold: "≤ 10%", actual: "7.2%", status: "pass" },
    { name: "最大 Broken", threshold: "≤ 40", actual: "37", status: "pass" },
    { name: "最低カバレッジ", threshold: "≥ 70%", actual: "74.3%", status: "pass" }
  ],
  allureSummary: [
    { name: "パス率 (30 日)", previous: "前回 82.1%", actual: "88.2%", status: "pass" },
    { name: "平均所要時間", previous: "前回 2h 47m", actual: "2h 18m", status: "pass" },
    { name: "テスト/日", previous: "直近 7 日", actual: "624", status: "pass" }
  ],
  recentRuns: [
    {
      id: "r1",
      timestamp: "2024/05/18 10:24",
      status: "passed",
      passRate: "88.2%",
      trend: "up"
    },
    {
      id: "r2",
      timestamp: "2024/05/16 09:18",
      status: "passed",
      passRate: "84.6%",
      trend: "up"
    },
    {
      id: "r3",
      timestamp: "2024/05/13 14:51",
      status: "flaky",
      passRate: "81.3%",
      trend: "flat"
    },
    {
      id: "r4",
      timestamp: "2024/05/10 10:05",
      status: "failed",
      passRate: "75.2%",
      trend: "down"
    },
    {
      id: "r5",
      timestamp: "2024/05/08 08:44",
      status: "passed",
      passRate: "83.1%",
      trend: "up"
    }
  ]
};
