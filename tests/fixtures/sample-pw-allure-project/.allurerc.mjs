// Allure 3 設定ファイル (Phase 1.2 検証用 fixture)。
// T200 投資調査メモで確定した形式に従う:
//   - historyPath: JSONL 単一ファイル
//   - plugins.log: AI/QMO summary 用 (T207 が読む)
//   - plugins.csv: CSV export 用 (T207 が読む)
//
// `allure generate ./allure-results -o ./allure-report` 実行時に本 config が
// 読み込まれ、historyPath と plugins 設定が適用される。
// Workbench は本 config を **直接読まない** (Workbench は CLI subprocess で
// `allure` を起動するだけ)。fixture 内で完結した Allure 設定。
//
// Path 整合性 (drift 防止):
//   playwright.config.ts:20 の resultsDir "allure-results" と本ファイルの
//   `output` "./allure-report" は detect/archive/copy パターンの両端を成す。
//   T202 が allurerc.mjs を rewrite する際、playwright.config.ts:20 と
//   本ファイルの paths は **同じディレクトリ pair** を指している必要がある。
//   片方だけ変更すると Workbench の results→report 連携が silent に壊れる。
import { defineConfig } from "allure";

export default defineConfig({
  name: "Sample Playwright Allure Fixture",
  output: "./allure-report",
  historyPath: "./allure-history.jsonl",
  plugins: {
    log: { options: {} },
    csv: { options: { separator: "," } },
  },
});
