# sample-pw-allure-project

Phase 1.2 (Allure Report 3 統合 PoC) 検証用 fixture。Workbench (`apps/agent`) が Phase 1.2 (T202〜T208) で **AllureReportProvider / detect-archive-copy / Quality Gate / QMO summary** を実装する際に、入力データセットとして使われる Playwright project です。

## 重要: ルートの `pnpm test` から実行されません

本 fixture は Workbench Phase 1.2 の機能群が runtime に呼び出す **入力 fixture** であり、ルート workspace の `pnpm test`（`pnpm --filter '@pwqa/*' test`）にはマッチしません（このパッケージ名は `@pwqa-fixture/...` スコープ）。

`tests/example.spec.ts` には **意図的に failing** な test が含まれます (`expect(1+1).toBe(3)`)。これは T204 (HTML report) / T205 (Quality Gate) / T207 (QMO summary) で「実際の failed test result」を validate するために必須です。CI が red になる経路はありません。

## 構造

| ファイル | 役割 |
|---|---|
| `package.json` | `@playwright/test` + `allure-playwright` + `allure` (Allure 3 CLI) を patch-only pin (`~3.6.2` / `~3.7.1`) |
| `playwright.config.ts` | reporter 配列に `allure-playwright` を **静的 string literal** な `resultsDir: "allure-results"` で設定 (Workbench の ProjectScanner ヒューリスティック検出を validate) |
| `.allurerc.mjs` | Allure 3 設定: `historyPath` JSONL、`plugins.log` / `plugins.csv` |
| `tests/example.spec.ts` | 1 件 passing + 1 件 intentionally failing |
| `.gitignore` | `allure-results/` / `allure-report/` / `allure-history.jsonl` / `playwright-results.json` 等の生成 artifact を ignore |

## 検証用コマンド (手元で動作確認したいとき)

```bash
cd tests/fixtures/sample-pw-allure-project

# テスト一覧 (browser 不要)
pnpm run list

# 実テスト実行 (browser が必要なテストはないので CI でも動く)
pnpm run test:allure

# Allure HTML report 生成
pnpm run allure:generate

# Quality Gate (failing test があるので exit 1 になる想定)
pnpm run allure:quality-gate
```

これらのコマンドはあくまで **手動確認用**。Phase 1.2 完成後は Workbench が同等のシーケンスを内部で組み立てて実行します。

## 関連設計メモ

- `docs/design/t201-allure-fixture-project.md` — 本 fixture の設計判断
- `docs/design/phase-1-2-allure-investigation.md` — Allure CLI / package 調査結果 (本 fixture の version pin の根拠)
- `PLAN.v2.md` §22 (Allure Report 3 Integration Design) / §38 (Implementation Prompts)
