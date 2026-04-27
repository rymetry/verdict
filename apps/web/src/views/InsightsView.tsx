/**
 * Insights View — Phase 1 では static mock。
 *
 * Phase 1.2 で Allure 統合 + Quality Gate 評価が実装されたら下記 MOCK_DATA を
 * API レスポンスで置換。Allure と競合しないよう「決定支援レイヤー」として
 * 位置づけ — 詳細レポートは Allure に委譲し、当 view は Quality Gate / AI
 * 判定 / 危険信号サマリのみ提供する。
 */

// ─── MOCK_DATA — TODO(Phase 1.2): replace with live API responses ────────
const MOCK_DATA = {
  release: {
    score: 86,
    label: "Ready" as const,
    rcVersion: "v2.14.0-rc",
    summary:
      "全 6 つの Quality Gate ルールをパス。重大な失敗 3 件と Flaky 3 件を確認すれば本番昇格可。"
  },
  stats: {
    total: 2842,
    passed: 2486,
    failed: 198,
    flaky: 37,
    skipped: 121
  },
  criticals: [
    {
      scope: "checkout",
      title: "should complete payment",
      meta: "tests/e2e/checkout.spec.ts:112 · chromium · 3m ago"
    },
    {
      scope: "search",
      title: "filters › price range",
      meta: "tests/e2e/search/filters.spec.ts:78 · webkit · 12m ago"
    },
    {
      scope: "profile",
      title: "update › saves changes",
      meta: "tests/e2e/profile/update.spec.ts:54 · firefox · 16m ago"
    }
  ],
  knownIssues: [
    { title: "Payment gateway timeout in CI", meta: "#1024 · Open · High" },
    { title: "Flaky: product list virtual scroll", meta: "#987 · Open · Medium" },
    { title: "Intermittent auth redirect", meta: "#956 · Open · Medium" }
  ],
  topFlaky: [
    {
      scope: "search",
      title: "autocomplete suggestions",
      meta: "tests/e2e/search.auto.spec.ts:23 · 24%"
    },
    {
      scope: "cart",
      title: "remove item",
      meta: "tests/e2e/cart.remove.spec.ts:41 · 18%"
    },
    {
      scope: "homepage",
      title: "hero carousel",
      meta: "tests/e2e/home.hero.spec.ts:17 · 15%"
    }
  ],
  qualityGate: {
    verdict: "Passed" as const,
    rules: [
      { name: "最低パス率", thresh: "≥ 85%", actual: "88.2%", pass: true },
      { name: "最大失敗数", thresh: "≤ 200", actual: "198", pass: true },
      { name: "重大な失敗", thresh: "= 0", actual: "0", pass: true },
      { name: "Flaky リスク上限", thresh: "≤ 10%", actual: "7.2%", pass: true },
      { name: "最大 Broken", thresh: "≤ 40", actual: "37", pass: true },
      { name: "最低カバレッジ", thresh: "≥ 70%", actual: "74.3%", pass: true }
    ]
  },
  allure: [
    { name: "パス率 (30 日)", thresh: "前回 82.1%", actual: "88.2%" },
    { name: "平均所要時間", thresh: "前回 2h 47m", actual: "2h 18m" },
    { name: "テスト/日", thresh: "直近 7 日", actual: "624" }
  ],
  recentRuns: [
    { ts: "2024/05/18 10:24", status: "passed" as const, rate: "88.2%" },
    { ts: "2024/05/16 09:18", status: "passed" as const, rate: "84.6%" },
    { ts: "2024/05/13 14:51", status: "flaky" as const, rate: "81.3%" },
    { ts: "2024/05/10 10:05", status: "failed" as const, rate: "75.2%" },
    { ts: "2024/05/08 08:44", status: "passed" as const, rate: "83.1%" }
  ],
  aiSummary: {
    body:
      "総合品質は良好で、前回比でパス率が +6.1pp 改善。リスクは checkout / search の 3 件の重大な失敗に集中。Flaky リスクは許容範囲内 (7.2%) ですが、上位 3 件は次回 sprint で対処推奨。前回ブロッカー (#1024 Payment gateway timeout) は新規発生していません。",
    verdictLead: "本番昇格可能",
    verdictBody: "重大な失敗 3 件を確認後、デプロイ可。"
  }
} as const;

const RUN_STATE_TO_TREND: Record<"passed" | "failed" | "flaky", string> = {
  passed: "up",
  failed: "dn",
  flaky: ""
};

export function InsightsView() {
  const { release, stats, criticals, knownIssues, topFlaky, qualityGate, allure, recentRuns, aiSummary } =
    MOCK_DATA;

  return (
    <div className="view view-qmo">
      <div className="qmo-main">

        <section className="qmo-hero" aria-labelledby="release-readiness-title">
          <div>
            <h2 id="release-readiness-title">Release Readiness</h2>
            <div className="qmo-score">
              <span className="num">{release.score}</span>
              <span className="max">/ 100</span>
              <span className="verdict">{release.label}</span>
            </div>
            <div className="qmo-bar">
              <div className="qmo-bar-fill" style={{ width: `${release.score}%` }} />
            </div>
            <p>{release.rcVersion} · {release.summary}</p>
            <p className="qmo-disclaimer">
              ※ 表示データは Phase 1.2 (Allure 統合 + Quality Gate 評価) でライブ接続予定。現在は static mock。
            </p>
          </div>
          <div className="qmo-stats">
            <div className="qmo-stat"><span className="label">Total</span><span className="num">{stats.total.toLocaleString()}</span></div>
            <div className="qmo-stat"><span className="label">Passed</span><span className="num pass">{stats.passed.toLocaleString()}</span></div>
            <div className="qmo-stat"><span className="label">Failed</span><span className="num fail">{stats.failed.toLocaleString()}</span></div>
            <div className="qmo-stat"><span className="label">Flaky</span><span className="num flaky">{stats.flaky.toLocaleString()}</span></div>
            <div className="qmo-stat"><span className="label">Skipped</span><span className="num skip">{stats.skipped.toLocaleString()}</span></div>
          </div>
        </section>

        <section className="qmo-cards">
          <article className="qmo-card">
            <div className="qmo-card-head">
              <h3>重大な失敗</h3>
              <span className="count">{criticals.length}</span>
              <DisabledMore />
            </div>
            <ul>
              {criticals.map((it) => (
                <li key={`${it.scope}-${it.title}`}>
                  <span className="item-title"><span className="scope">{it.scope} ›</span> {it.title}</span>
                  <span className="item-meta">{it.meta}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="qmo-card">
            <div className="qmo-card-head">
              <h3>既知の問題</h3>
              <span className="count">{knownIssues.length}</span>
              <DisabledMore />
            </div>
            <ul>
              {knownIssues.map((it) => (
                <li key={it.title}>
                  <span className="item-title">{it.title}</span>
                  <span className="item-meta">{it.meta}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="qmo-card">
            <div className="qmo-card-head">
              <h3>Top Flaky</h3>
              <span className="count">{topFlaky.length}</span>
              <DisabledMore />
            </div>
            <ul>
              {topFlaky.map((it) => (
                <li key={`${it.scope}-${it.title}`}>
                  <span className="item-title"><span className="scope">{it.scope} ›</span> {it.title}</span>
                  <span className="item-meta">{it.meta}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className="qmo-ai" aria-labelledby="ai-summary-title">
          <div className="qmo-ai-head">
            <h3 id="ai-summary-title">AI リリース判定 サマリ</h3>
            <span className="pill">Claude Code · Beta</span>
          </div>
          <p>{aiSummary.body}</p>
          <div className="verdict">
            推奨: <strong>{aiSummary.verdictLead}</strong>。{aiSummary.verdictBody}
          </div>
        </section>
      </div>

      <aside className="qmo-side">
        <div className="rules-table">
          <div className="head">
            <h3>Quality Gate</h3>
            <span className="pass-pill">{qualityGate.verdict}</span>
          </div>
          {qualityGate.rules.map((r) => (
            <div className="rule-row" key={r.name}>
              <span className="rule-name">{r.name}</span>
              <span className="rule-thresh">{r.thresh}</span>
              <span className={`rule-actual ${r.pass ? "pass" : "fail"}`}>{r.actual}</span>
            </div>
          ))}
        </div>

        <div className="rules-table">
          <div className="head">
            <h3>Allure サマリ</h3>
            <DisabledMore label="フルレポート ›" />
          </div>
          {allure.map((r) => (
            <div className="rule-row" key={r.name}>
              <span className="rule-name">{r.name}</span>
              <span className="rule-thresh">{r.thresh}</span>
              <span className="rule-actual pass">{r.actual}</span>
            </div>
          ))}
        </div>

        <div>
          <div className="qmo-side-head">
            <h3>最近の Run</h3>
            <DisabledMore />
          </div>
          <ul className="recent-runs">
            {recentRuns.map((run) => (
              <li key={run.ts}>
                <span className="ts">{run.ts}</span>
                <span className={`badge ${run.status}`}>{capitalize(run.status)}</span>
                <span className={`pr ${RUN_STATE_TO_TREND[run.status]}`}>{run.rate}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Phase 1.2 で実 navigation に置換予定の disabled affordance。 */
function DisabledMore({ label = "すべて表示 ›" }: { label?: string }) {
  return (
    <button
      type="button"
      className="more"
      disabled
      title="Phase 1.2 で接続予定"
    >
      {label}
    </button>
  );
}
