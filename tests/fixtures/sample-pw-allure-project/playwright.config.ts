import { defineConfig } from "@playwright/test";

// Phase 1.2 (Issue: Allure Report 3 統合 PoC) 検証用 fixture。
// allure-playwright reporter を **静的 string literal の resultsDir** で
// 設定することで、Workbench の ProjectScanner ヒューリスティック検出
// (T200 投資調査メモ参照) が確実にこのパスを取り出せるようにする。
// 動的 config / env 参照型の reporter 設定は Phase 1.2 の検出失敗ケースを
// 検証するための別 fixture で扱う (将来追加)。
export default defineConfig({
  testDir: "./tests",
  reporter: [
    // list: ローカル CLI 実行時の人間可読ストリーム。
    // json: PLAN.v2 §21 / §29 で Workbench の inventory + summary 解析に使う
    //       Playwright 標準 JSON。Phase 1 で AllureReportProvider と並ぶ
    //       playwrightJsonReportProvider の入力。Allure と並列に出力する
    //       ことで、Workbench は片方が壊れてももう片方で recovery できる。
    // allure-playwright: Phase 1.2 の主役。Allure 3 形式の results を吐き、
    //       後段の `allure generate` / `allure quality-gate` の入力になる。
    ["list"],
    ["json", { outputFile: "playwright-results.json" }],
    [
      "allure-playwright",
      {
        // resultsDir は Workbench の detect/archive/copy パターンで読み取られる。
        // Phase 1.2 では default 名 "allure-results" を採用し、PLAN.v2 §22 の
        // 検出ロジックの最も典型的な経路を validate する。
        resultsDir: "allure-results",
        detail: true,
        suiteTitle: true,
      },
    ],
  ],
  // Phase 1.2 の primary な検証は results 出力 + report 生成 + Quality Gate
  // パイプライン。実ブラウザを必須にしない sanity-check spec を tests/ に
  // 置くため、ここでは use 設定を空にする。Phase 6 で headed/headless 切替を
  // GUI から行う際に、この fixture も browsers: chromium でリプレイされる予定。
  use: {},
});
