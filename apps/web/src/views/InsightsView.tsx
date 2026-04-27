/**
 * Insights View — Phase 1 では static mock。
 * Phase 1.2 で Allure 統合 + Quality Gate 評価が実装されたら実データに置換。
 * Allure と競合しないよう「決定支援レイヤー」として位置づけ:
 *   - 詳細レポートは Allure に委譲 (フルレポートリンク)
 *   - 当 view は Quality Gate / AI 判定 / 危険信号サマリのみ提供
 */
export function InsightsView() {
  return (
    <div className="view view-qmo">
      <div className="qmo-main">

        <section className="qmo-hero">
          <div>
            <h1>Release Readiness</h1>
            <div className="qmo-score">
              <span className="num">86</span>
              <span className="max">/ 100</span>
              <span className="verdict">Ready</span>
            </div>
            <div className="qmo-bar">
              <div className="qmo-bar-fill" style={{ width: "86%" }} />
            </div>
            <p>
              v2.14.0-rc · 全 6 つの Quality Gate ルールをパス。重大な失敗 3 件と Flaky
              3 件を確認すれば本番昇格可。
            </p>
            <p style={{ marginTop: 8, fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
              ※ 表示データは Phase 1.2 (Allure 統合 + Quality Gate 評価) でライブ接続予定。現在は static mock。
            </p>
          </div>
          <div className="qmo-stats">
            <div className="qmo-stat"><span className="label">Total</span><span className="num">2,842</span></div>
            <div className="qmo-stat"><span className="label">Passed</span><span className="num pass">2,486</span></div>
            <div className="qmo-stat"><span className="label">Failed</span><span className="num fail">198</span></div>
            <div className="qmo-stat"><span className="label">Flaky</span><span className="num flaky">37</span></div>
            <div className="qmo-stat"><span className="label">Skipped</span><span className="num skip">121</span></div>
          </div>
        </section>

        <section className="qmo-cards">
          <article className="qmo-card">
            <div className="qmo-card-head">
              <h3>重大な失敗</h3>
              <span className="count">3</span>
              <a className="more" href="#all-criticals">すべて表示 ›</a>
            </div>
            <ul>
              <li>
                <span className="item-title"><span className="scope">checkout ›</span> should complete payment</span>
                <span className="item-meta">tests/e2e/checkout.spec.ts:112 · chromium · 3m ago</span>
              </li>
              <li>
                <span className="item-title"><span className="scope">search ›</span> filters › price range</span>
                <span className="item-meta">tests/e2e/search/filters.spec.ts:78 · webkit · 12m ago</span>
              </li>
              <li>
                <span className="item-title"><span className="scope">profile ›</span> update › saves changes</span>
                <span className="item-meta">tests/e2e/profile/update.spec.ts:54 · firefox · 16m ago</span>
              </li>
            </ul>
          </article>

          <article className="qmo-card">
            <div className="qmo-card-head">
              <h3>既知の問題</h3>
              <span className="count">8</span>
              <a className="more" href="#all-known">すべて表示 ›</a>
            </div>
            <ul>
              <li>
                <span className="item-title">Payment gateway timeout in CI</span>
                <span className="item-meta">#1024 · Open · High</span>
              </li>
              <li>
                <span className="item-title">Flaky: product list virtual scroll</span>
                <span className="item-meta">#987 · Open · Medium</span>
              </li>
              <li>
                <span className="item-title">Intermittent auth redirect</span>
                <span className="item-meta">#956 · Open · Medium</span>
              </li>
            </ul>
          </article>

          <article className="qmo-card">
            <div className="qmo-card-head">
              <h3>Top Flaky</h3>
              <span className="count">37</span>
              <a className="more" href="#all-flaky">すべて表示 ›</a>
            </div>
            <ul>
              <li>
                <span className="item-title"><span className="scope">search ›</span> autocomplete suggestions</span>
                <span className="item-meta">tests/e2e/search.auto.spec.ts:23 · 24%</span>
              </li>
              <li>
                <span className="item-title"><span className="scope">cart ›</span> remove item</span>
                <span className="item-meta">tests/e2e/cart.remove.spec.ts:41 · 18%</span>
              </li>
              <li>
                <span className="item-title"><span className="scope">homepage ›</span> hero carousel</span>
                <span className="item-meta">tests/e2e/home.hero.spec.ts:17 · 15%</span>
              </li>
            </ul>
          </article>
        </section>

        <section className="qmo-ai">
          <div className="qmo-ai-head">
            <h3>AI リリース判定 サマリ</h3>
            <span className="pill">Claude Code · Beta</span>
          </div>
          <p>
            総合品質は良好で、前回比でパス率が +6.1pp 改善。リスクは checkout / search の 3
            件の重大な失敗に集中。Flaky リスクは許容範囲内 (7.2%) ですが、上位 3 件は次回 sprint
            で対処推奨。前回ブロッカー (#1024 Payment gateway timeout) は新規発生していません。
          </p>
          <div className="verdict">
            推奨: <strong>本番昇格可能</strong>。重大な失敗 3 件を確認後、デプロイ可。
          </div>
        </section>
      </div>

      <aside className="qmo-side">
        <div className="rules-table">
          <div className="head">
            <h3>Quality Gate</h3>
            <span className="pass-pill">Passed</span>
          </div>
          <div className="rule-row">
            <span className="rule-name">最低パス率</span>
            <span className="rule-thresh">≥ 85%</span>
            <span className="rule-actual pass">88.2%</span>
          </div>
          <div className="rule-row">
            <span className="rule-name">最大失敗数</span>
            <span className="rule-thresh">≤ 200</span>
            <span className="rule-actual pass">198</span>
          </div>
          <div className="rule-row">
            <span className="rule-name">重大な失敗</span>
            <span className="rule-thresh">= 0</span>
            <span className="rule-actual pass">0</span>
          </div>
          <div className="rule-row">
            <span className="rule-name">Flaky リスク上限</span>
            <span className="rule-thresh">≤ 10%</span>
            <span className="rule-actual pass">7.2%</span>
          </div>
          <div className="rule-row">
            <span className="rule-name">最大 Broken</span>
            <span className="rule-thresh">≤ 40</span>
            <span className="rule-actual pass">37</span>
          </div>
          <div className="rule-row">
            <span className="rule-name">最低カバレッジ</span>
            <span className="rule-thresh">≥ 70%</span>
            <span className="rule-actual pass">74.3%</span>
          </div>
        </div>

        <div className="rules-table">
          <div className="head">
            <h3>Allure サマリ</h3>
            <a
              href="#allure-full"
              style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--accent)" }}
            >
              フルレポート ›
            </a>
          </div>
          <div className="rule-row">
            <span className="rule-name">パス率 (30 日)</span>
            <span className="rule-thresh">前回 82.1%</span>
            <span className="rule-actual pass">88.2%</span>
          </div>
          <div className="rule-row">
            <span className="rule-name">平均所要時間</span>
            <span className="rule-thresh">前回 2h 47m</span>
            <span className="rule-actual pass">2h 18m</span>
          </div>
          <div className="rule-row">
            <span className="rule-name">テスト/日</span>
            <span className="rule-thresh">直近 7 日</span>
            <span className="rule-actual pass">624</span>
          </div>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "baseline", padding: "0 0 10px" }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--ink-0)" }}>
              最近の Run
            </h3>
            <a
              href="#all-runs"
              style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--accent)" }}
            >
              すべて表示 ›
            </a>
          </div>
          <ul className="recent-runs">
            <li>
              <span className="ts">2024/05/18 10:24</span>
              <span className="badge passed">Passed</span>
              <span className="pr up">88.2%</span>
            </li>
            <li>
              <span className="ts">2024/05/16 09:18</span>
              <span className="badge passed">Passed</span>
              <span className="pr up">84.6%</span>
            </li>
            <li>
              <span className="ts">2024/05/13 14:51</span>
              <span className="badge flaky">Flaky</span>
              <span className="pr">81.3%</span>
            </li>
            <li>
              <span className="ts">2024/05/10 10:05</span>
              <span className="badge failed">Failed</span>
              <span className="pr dn">75.2%</span>
            </li>
            <li>
              <span className="ts">2024/05/08 08:44</span>
              <span className="badge passed">Passed</span>
              <span className="pr up">83.1%</span>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
