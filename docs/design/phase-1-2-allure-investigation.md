# T200: Allure Report 3 + allure-playwright 調査メモ (Phase 1.2 prep)

## 調査目的

PLAN.v2 §38 Allure Integration Prompt 1 に従い、Phase 1.2 Allure 統合の実装着手前に **package 名・CLI 構文・設定方法・Quality Gate 仕様・log/csv 出力形式** を確定し、既存設計 (PLAN.v2 §10 / §22 / §23) との差分を洗い出す。**コード変更なし**。

## 調査ソース

- 公式 docs: https://allurereport.org/docs/v3/install/, https://allurereport.org/docs/quality-gate/
- Context7 MCP: `/allure-framework/allure3` (101 snippets, High reputation, score 66.25)
- Context7 MCP: `/allure-framework/allure-js` (60 snippets, High reputation)
- Context7 MCP: `/allure-framework/allure-docs` (212 snippets, High reputation)

調査日: 2026-04-29

## 主要結論サマリ

| 項目 | 結論 | PLAN.v2 §22/§23 との差分 |
|---|---|---|
| CLI npm package 名 | `allure` (Allure 3 の正式パッケージ名) | 記載なし。Phase 1.2 で明示 pin が必要 |
| Allure 2 CLI との衝突 | 旧 `allure-commandline` (Allure 2) と区別が必要 | 記載なし。PackageManagerDetector or version check が必要 |
| `allure quality-gate` exit code | 0 = pass / 1 = fail (確定) | §23 の "exitCode 保存" 方針と整合 |
| `allure quality-gate` flags | `--max-failures` / `--success-rate` / `--min-tests-count` / `--fast-fail` / `--known-issues <path>` | §23 の profile (local-review / release-smoke / full-regression) は**全て CLI flag で表現可能**。`allurerc.mjs` の config 経由でも可 |
| `allure quality-gate` stdout format | docs に明示なし。raw 保存 + exit code 判定が安全 | §23 の "raw stdout/stderr 保存を基本、CLI help 確認後に parse 層追加" 方針と整合 |
| `allure agent` コマンド | **存在しない** (Context7 / 公式 docs / npm 全て参照なし) | §10 / §38 で「依存しない」と明記済み。再確認完了 |
| Allure history 形式 | `historyPath: "./history.jsonl"` を `allurerc.mjs` で指定 (JSONL) | §10 / §18 の `.playwright-workbench/reports/allure-history.jsonl` と整合 |
| `ALLURE_RESULTS_DIR` env var | 公式 docs / Context7 に記載なし。adapter source からも参照経路を確認できず | §22 の "env var で run 単位ディレクトリ直接出力できるか確認する" → **使えない前提で進める**。detect/archive/copy パターンが正解 |
| `allure generate` 構文 | `allure generate <results-dir> -o <report-dir> [--config <allurerc>] [--report-name <name>]` | §22 の生成手順と整合 |
| `allure csv` 構文 | `allure csv <results-dir> --output <file> [--separator ";"] [--disable-headers] [--known-issues <path>]` | §10 / §22 の CSV/log 出力と整合 |
| `allure log` コマンド | CLI コマンドとしての記載なし。代わりに `plugin-log` (`@allurereport/plugin-log`) を `allurerc.mjs` の `plugins.log` で有効化する形 | §10 の `allure log` 出力は「plugin-log を有効化したうえで `allure generate` の副産物として得る」形に変更が必要 |
| `allure run` (テスト実行 + report 生成 wrapper) | docs 記載あり。Phase 1.2 PoC では明示シーケンス (`playwright test` → `allure generate` → `allure quality-gate`) を推奨。`allure run` は CI 全部おまかせ用。 | §22 の方針 (明示シーケンス) と整合 |
| 既知 issues 機能 | `--known-issues <path>.json` 第一級サポート。`historyId` ベース | §22 の known issues と整合 |
| Programmatic API | `@allurereport/core` の `AllureReport` / `resolveConfig` / `validate` で CLI 相当を Node.js プロセス内で実行可能 | **新発見**。CLI subprocess に頼らない選択肢あり |

## 推奨される Phase 1.2 実装方針

### 1. CLI vs Programmatic API の選択

PLAN.v2 §22 は CLI subprocess (`allure generate` / `allure quality-gate`) を前提に detect/archive/copy パターンを設計している。Context7 で発見した `@allurereport/core` Programmatic API を使うと:

- **Pros**: subprocess 起動コストなし。stdout/stderr の流出経路が無く secret redaction が不要。型安全。Node 内で完結。
- **Cons**: PLAN.v2 §22 の Open Questions で「CLI subprocess を前提」とあり、設計再調整が必要。Allure 3 が Programmatic API の API safety/stability を保証しているか不明。`@allurereport/core` の追加 dependency。

**Phase 1.2 推奨**: **CLI subprocess を第一選択**として設計どおり進める。理由:
- PLAN.v2 §14 (CommandRunner) の audit log + policy enforcement レイヤを既に持っており、subprocess 統一が運用 hygiene 上望ましい
- Programmatic API は `@allurereport/core` の semver 保証が読み切れず、PoC 段階で API 変更に追随するリスクを取らない
- 将来 Phase 6 (Playwright Operations GUI) で `allure serve` 等を追加した際に、CLI と Programmatic を混在させたくない

`@allurereport/core` Programmatic API は **将来 Phase 8/10 (CI 統合 / ReportPortal 並行運用) で再評価** する。

### 2. Quality Gate profile 表現

PLAN.v2 §23 の 3 profile を、`allurerc.mjs` の config + CLI flag どちらで表現するか:

| profile | 表現方法 | 例 |
|---|---|---|
| `local-review` | CLI flag のみ (config 不要) | `allure quality-gate ./allure-results --max-failures 0` |
| `release-smoke` | CLI flag (`--max-failures 0 --success-rate 100`) | smoke run 用 |
| `full-regression` | `allurerc.mjs` の `qualityGate.rules[]` で expressive な構成。`maxFailures` / `successRate` / `minTestsCount` / `fastFail` を組合せ | full regression run 用 |

**推奨**: 全 profile を `allurerc.mjs` (Workbench 生成、project root には書かない) で管理し、`--config` で切り替え。CLI flag は debug/override 用途のみ。理由: profile rules が増えた際に config 一元化が保守的。

config 配置案: `.playwright-workbench/config/allure-profiles/<profile>.allurerc.mjs`。Workbench は profile 選択時に該当 config を `--config` で渡す。

### 3. History 保存

`historyPath: ".playwright-workbench/reports/allure-history.jsonl"` を `allurerc.mjs` (Workbench 生成 config) で指定。Allure CLI が JSONL を append/rewrite してくれるため、Workbench は `allure-history.jsonl` を読み書きしない (PLAN.v2 §10 / §18 通り)。

**注意**: history は `allurerc.mjs` 経由でしか指定できない (CLI flag 直接指定の確認は未完了)。Workbench は実行のたびに正しい `allurerc.mjs` を生成する必要がある。

### 4. AI / QMO summary 生成

PLAN.v2 §10 では「Workbench 側で `allure log` / `allure csv` 出力 + raw allure-results JSON + Playwright JSON から Markdown/JSON summary を生成する」方針。

調査で判明した実態:
- `allure csv` は CLI コマンドとして第一級サポート → そのまま採用
- `allure log` は CLI コマンドではなく、`plugin-log` (`@allurereport/plugin-log`) を `allurerc.mjs` で有効化する形 → **採用方針**: `allurerc.mjs` の plugins に `log` を追加 → `allure generate` 実行時に副産物として log artifact が生成される → Workbench は `.playwright-workbench/runs/<runId>/allure-exports/` 配下から拾う
- `allure-results` の raw JSON は subprocess 経由で読み取り (parser 自前)

QMO summary v0 (T207) の実装時:
1. `allurerc.mjs` で `plugins.log = { options: {} }` を有効化
2. `allure generate` 実行
3. log/csv artifact が `.playwright-workbench/runs/<runId>/allure-exports/` (Allure 出力 dir) に生成される
4. Workbench がこれらを読み取り Markdown summary に整形

### 5. resultsDir lifecycle

`ALLURE_RESULTS_DIR` env var が使えないことが確定したので、PLAN.v2 §22 の **detect/archive/copy パターン**を Phase 1.2 標準とする:

```
[テスト実行前]
1. ProjectScanner が playwright.config から allure-playwright reporter の resultsDir を検出
2. 検出した resultsDir 内に既存ファイルがあれば
   `.playwright-workbench/archive/<timestamp>/` へ退避 (archive)
3. resultsDir が空 or 存在しない状態でテスト実行

[テスト実行]
4. allure-playwright が resultsDir に results を書き込む

[テスト実行後]
5. resultsDir の内容を `.playwright-workbench/runs/<runId>/allure-results/` に
   コピー (copy / detect)
6. 以降の Allure CLI 操作は `runs/<runId>/allure-results/` を入力にして実行
```

resultsDir 検出不能 (config が動的生成・env var 経由など) の場合は、GUI で「resultsDir が検出できません。Workbench config で明示してください」と表示し Allure 連携をスキップ。

### 6. 既存 project が Allure 未導入の場合

PoC では「Allure setup required」と表示し、必要 dependencies (`allure-playwright` + `allure` CLI) と `playwright.config.ts` の reporter 追加 diff を生成。**自動適用しない** (PLAN.v2 §22)。

検証用 fixture project (T201) では `allure-playwright` と `allure` を pre-install して Phase 1.2 を証明する。

## Phase 1.2 のオープンクエスチョン (実装時に確認する)

1. **`allure quality-gate` の stdout が JSON か text か** — docs で明示なし。実装時に CLI を実行して確認 → PoC は raw 保存ファースト方針で進む
2. **`allurerc.mjs` の `qualityGate.rules[]` 完全 schema** — docs に部分例しかない。`allurerc` を Workbench が生成する際の TypeScript types は `@allurereport/core` の `Config` 型を import するか、自前で zod schema を定義するか
3. **`historyPath` の CLI flag 直接指定** — `--history-path` が `allure generate` に存在するかは未確認。`allurerc.mjs` 経由が確実
4. **`plugin-log` の出力 path 指定方法** — config の `plugins.log.options` 経由か、別 dir 指定が必要か
5. **Allure 2 CLI が install されている場合の検出** — `allure-commandline` パッケージ存在検出 + CLI version check が Phase 1.2 startup で必要
6. **`allure-playwright` resultsDir のヒューリスティック検出失敗率** — 動的 config / env-var 参照の正確な検出は不可能。Workbench config による明示 override path の併用を強く推奨

## PLAN.v2 への提案修正

本調査結果に基づき、以下を PLAN.v2 に **次回改訂時に反映** すべき (本調査では PLAN.v2 を変更しない):

1. **§38 Allure prompt 1**: 「`allure agent` コマンドの存在と仕様も確認してください」 → 確認完了 (存在しない)。次回改訂で「存在しないことを確認した」と明示
2. **§22 Open Questions**: 「`ALLURE_RESULTS_DIR` env var が使えるか」 → **使えない**ことを確認。次回改訂で削除 + detect/archive/copy が唯一の手段と明記
3. **§10**: `allure log` を CLI コマンドとして言及している箇所を「`plugin-log` を `allurerc.mjs` で有効化して generate の副産物として得る」と修正
4. **§22 / §23**: CLI npm package 名 `allure` (Allure 3) を明記 + `allure-commandline` (Allure 2) との衝突検出を Phase 1.2 startup check に含める
5. **§29**: Phase 1.2 で作るタスク一覧に「`allurerc.mjs` 生成器」「Allure CLI version check」を追加検討

## Phase 1.2 着手準備チェックリスト

- [x] CLI package 名 `allure` を確定
- [x] `allure quality-gate` exit code 0/1 を確定
- [x] `allure agent` 不在を確定
- [x] history JSONL 形式 + `historyPath` 設定を確定
- [x] detect/archive/copy パターンが必要 (env-var 不在) を確定
- [x] `plugin-log` 利用方針を確定
- [ ] T201: 検証 fixture project を `tests/fixtures/` に作成 (allure-playwright + allure 両方を devDependency として pin)
- [ ] T202: `AllureReportProvider` 抽象設計 (results 読み取り / report path / history / quality-gate / csv-log の 5 source を統一)
- [ ] 実装着手前に Allure CLI 実機実行で stdout 形式を 1 度 sanity check (T203 開始時の最初の作業)

## 失敗カウンタ (T200 リトライ追跡)

- phase_4_5_failure_count: 0
- pr_merge_failure_count: 0
