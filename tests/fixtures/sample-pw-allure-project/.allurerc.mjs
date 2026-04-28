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
