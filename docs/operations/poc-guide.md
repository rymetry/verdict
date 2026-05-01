# PoC Operations Guide

Phase 0 / Phase 1 / Phase 1.2 が完了した時点での **PoC 実行マニュアル**です。Workbench を立ち上げて、実 Playwright プロジェクトに対して run 〜 Allure HTML report 〜 Quality Gate 〜 QMO Release Readiness Summary までを 1 周回す手順を記載します。

> **対象読者**: PoC を試したい QA エンジニア / SDET / QMO。React や Node.js の基礎は既知前提。

---

## 1. 動作環境

- **Node.js ≥ 24** (Active LTS "Krypton")。Node 25 (Current) でも動作。Node 22 はサポート対象外
- **pnpm 10.8.0** (workspace 管理)
- **macOS / Linux** (Phase 1 PoC スコープ)。Windows は Phase 2 以降
- 検証対象 Playwright プロジェクトに **`@playwright/test` ^1.55** が devDependency として install 済

> Allure 機能を使う場合のみ、対象プロジェクトに `allure-playwright` と `allure` (Allure 3 CLI) が必要。本ガイド §6 で詳述。

---

## 2. 初回セットアップ

```bash
git clone https://github.com/rymetry/playwright-workbench.git
cd playwright-workbench
pnpm install
pnpm typecheck      # 全 workspace の型チェック
pnpm build          # shared / agent / web の build
pnpm test           # 全 unit / integration test (725 件)
```

`pnpm test` が green になれば installation は成功です。

---

## 3. 開発モードで起動 (PoC 確認の標準)

ターミナル 2 つに分けて Agent と Web をそれぞれ起動します。

### Terminal A — Local Agent

```bash
pnpm dev:agent
```

デフォルトで `http://127.0.0.1:4317` を listen。loopback only。CORS は `127.0.0.1:5173` / `localhost:5173` 等の dev 用 origin のみ許可。

### Terminal B — Web GUI

```bash
pnpm dev:web
```

Vite が `http://127.0.0.1:5173` で起動し、`/api` と `/ws` を Agent (4317) にプロキシします。

ブラウザで <http://127.0.0.1:5173> を開き、TopBar に "Playwright Workbench" が表示されれば起動 OK。

### バックグラウンド両起動

```bash
pnpm dev   # web + agent を parallel 実行
```

---

## 4. 環境変数 / CLI flag

Agent は以下を受け付けます:

### CLI flag (`apps/agent/dist/server.js` または `pnpm dev:agent` 起動時)

| Flag | 役割 |
|---|---|
| `--project /abs/path` / `-p /abs/path` | 起動時に開く Playwright project root の絶対パス |
| `--port <number>` | HTTP port (default `4317`) |

### 環境変数

| 変数 | 用途 | 既定値 |
|---|---|---|
| `PORT` | HTTP port (CLI flag が優先) | `4317` |
| `HOST` | bind host | `127.0.0.1` |
| `LOG_LEVEL` | pino log level (`silent` / `error` / `warn` / `info` / `debug` / `trace`) | `info` |
| `WORKBENCH_PROJECT_ROOT` | `--project` の env 形式 | — |
| `WORKBENCH_ALLOWED_ROOTS` | `:` 区切りの allowlist (project open のセキュリティガード) | (空) |
| `WORKBENCH_ALLOW_REMOTE` | `1` / `true` で 127.0.0.1 以外への bind を許可 (危険) | `0` |
| `AGENT_FAIL_CLOSED_AUDIT` | `1` / `true` で audit log 永続化失敗時 run を fail-closed に | `0` (fail-open) |

### 起動例

```bash
# 既存の Playwright プロジェクト 1 つだけを開けるようにする
WORKBENCH_ALLOWED_ROOTS="/Users/me/projects/my-pw-app" pnpm dev:agent

# CLI flag で初期 project + port を指定
node apps/agent/dist/server.js \
  --project /Users/me/projects/my-pw-app \
  --port 4317

# 起動と同時に project を開く (env 経由)
WORKBENCH_PROJECT_ROOT=/Users/me/projects/my-pw-app pnpm dev:agent
```

> `WORKBENCH_ALLOWED_ROOTS` を設定していない場合、**任意の絶対パス** を `POST /projects/open` で開けます。マルチプロジェクト環境では明示的に allowlist 設定推奨。

---

## 5. PoC を回す: シナリオ 1 — Allure なしの素 Playwright (Phase 1 PoC)

**何が確認できるか**: Workbench が既存 Playwright プロジェクトを認識し、GUI から run を起こし、stdout/stderr/Playwright JSON を集約する。

### 5.1 検証用のシンプルな Playwright プロジェクト

```bash
mkdir -p ~/tmp/sample-playwright && cd ~/tmp/sample-playwright
npm init -y
npm install --save-dev @playwright/test@^1.55
cat > playwright.config.ts <<'EOF'
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  reporter: [["list"]],
  use: {}
});
EOF
mkdir tests
cat > tests/example.spec.ts <<'EOF'
import { test, expect } from "@playwright/test";
test("passes", async () => { expect(1 + 1).toBe(2); });
test("fails @demo", async () => { expect(1 + 1).toBe(3); });
EOF
```

### 5.2 Workbench を立ち上げて project を開く

```bash
# Workbench リポジトリ側で
WORKBENCH_ALLOWED_ROOTS=$HOME/tmp/sample-playwright pnpm dev:agent
# 別ターミナルで
pnpm dev:web
```

ブラウザで <http://127.0.0.1:5173> → TopBar の "Open Project" → `/Users/<you>/tmp/sample-playwright` を入力 → **Open**。

成功すると:
- StatusBar に検出された package manager が出る
- Test Inventory パネルに `tests/example.spec.ts` の 2 件が並ぶ

### 5.3 Run を実行

QA View / Run Console で **Run all** をクリック。

GUI で起こること:
- Run Console に live で stdout / stderr が流れる
- Run が終わると "passed" / "failed" バッジ + failedTests のリスト
- StatusBar に最新 run の summary

ファイルシステムで起こること (`<projectRoot>/.playwright-workbench/runs/<runId>/`):
```
metadata.json                # RunMetadata (paths / summary / warnings)
stdout.log
stderr.log
playwright-results.json      # secret redact 済
playwright-report/           # Playwright HTML reporter (空の場合あり)
```

### 5.4 失敗 test を確認

Failure Review パネルに "fails @demo" が出る → file path / line / stack を確認。Phase 2 で artifact (trace / screenshot / video) viewer が追加される予定。

---

## 6. PoC を回す: シナリオ 2 — Allure 統合 (Phase 1.2 PoC)

**何が確認できるか**: Phase 1.2 lifecycle (detect → archive → generate HTML → Quality Gate → QMO summary) が end-to-end で動く。

### 6.1 対象プロジェクト要件

対象 Playwright プロジェクトに以下が必要:

```jsonc
// package.json (devDependencies)
{
  "@playwright/test": "^1.55.0",
  "allure-playwright": "~3.7.1",
  "allure": "~3.6.2"
}
```

```ts
// playwright.config.ts (allure-playwright を reporter 配列に追加)
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  reporter: [
    ["list"],
    ["json", { outputFile: "playwright-results.json" }],
    ["allure-playwright", {
      // 静的 string literal の resultsDir を必ず指定
      // (動的 config は ProjectScanner が検出できないため override が必要)
      resultsDir: "allure-results",
      detail: true,
      suiteTitle: true,
    }]
  ],
  use: {}
});
```

> 動作確認用に repo 同梱の `tests/fixtures/sample-pw-allure-project/` をそのまま流用可能。`pnpm install` 済みの状態で `allure-results/` も `node_modules/.bin/allure` も揃っています。

### 6.2 (任意) `.allurerc.mjs` 設定

Workbench は HTML生成時に CLI の `-o` を渡し、履歴は別ステップの `allure history --history-path` で生成します。`.allurerc.mjs` は必須ではありませんが、ユーザー固有のレポート名・plugin を入れたい場合は project root に設置:

```js
// .allurerc.mjs
import { defineConfig } from "allure";

export default defineConfig({
  name: "My Project Report",
  output: "./allure-report",   // CLI の -o で上書きされる
  historyPath: "./allure-history.jsonl",
  plugins: {
    log: { options: {} },
    csv: { options: { separator: "," } }
  }
});
```

### 6.3 Workbench で project を開く → run

シナリオ 1 と同じ手順で project open → Run all。Allure 設定が検出されると:

- ProjectScanner が `playwright.config.ts` から `resultsDir: "allure-results"` を抽出 → `summary.allureResultsDir = "allure-results"`
- Run 開始時: `archiveAllureResultsDir(projectRoot, projectRoot/allure-results)` が走り、既存の `allure-results/*` は `.playwright-workbench/archive/<timestamp>/` へ退避
- Playwright が走る → allure-playwright が `allure-results/` に書き出し
- Run 完了後の post-run hook で順番に:
  1. `redactPlaywrightResults` (Phase 1 既存)
  2. `copyAllureResultsDir` → `<runDir>/allure-results/`
  3. `generateAllureReport` (subprocess で `allure generate ./<runDir-relative>/allure-results -o <runDir-relative>/allure-report`)
  4. `latest-report/` を最新HTML reportのコピーで更新
  5. `allure history` / `allure csv` / `allure log` / `allure known-issue` で履歴と補助exportを生成
  6. `evaluateAllureQualityGate` (subprocess で `allure quality-gate ./<runDir-relative>/allure-results`) + 結果を `quality-gate-result.json` に persist
  7. `runQmoSummaryStep` で `qmo-summary.json` + `qmo-summary.md` を生成

### 6.4 結果の場所

```
<projectRoot>/.playwright-workbench/
├── reports/
│   └── allure-history.jsonl           # 全 run 累積 trend
├── archive/<timestamp>/
│   └── <archived-allure-files>        # 前回 run の保護済データ
└── runs/<runId>/
    ├── metadata.json                  # RunMetadata + warnings
    ├── stdout.log / stderr.log
    ├── playwright-results.json         # redact 済
    ├── playwright-report/              # Playwright HTML
    ├── allure-results/                 # コピーされた allure-playwright 出力
    ├── allure-report/                  # Allure CLI 生成 HTML
    │   └── index.html                  # ← ブラウザで開ける
    ├── quality-gate-result.json        # QualityGateResult schema 準拠
    ├── qmo-summary.json                # QmoSummary schema 準拠
    └── qmo-summary.md                  # PR comment 形式
```

### 6.5 GUI で QMO Summary を確認

ブラウザで `/qmo` route (TopBar の "QMO View" ナビ) を開く → 上部に **QMO Release Readiness banner** が表示:

| 状態 | 表示 |
|---|---|
| project 開いた直後 (run まだ) | "No runs yet. Trigger a test run to populate this summary." |
| run 中 / 直後で QMO 生成前 | banner 非表示 (loading) |
| Allure 未設定で QMO 生成失敗 | "QMO summary not yet generated for this run." |
| QMO 生成済み | Outcome バッジ (Ready / Conditional / Not Ready) + tests 集計 + QG status + duration |
| API エラー | "QMO summary unavailable" |

### 6.6 Allure HTML report を開く

現状 GUI 内 viewer はないため、ファイルから直接:

```bash
open <projectRoot>/.playwright-workbench/runs/<runId>/allure-report/index.html
# または
allure open <projectRoot>/.playwright-workbench/runs/<runId>/allure-report
```

### 6.7 QMO Markdown を PR に貼る

```bash
cat <projectRoot>/.playwright-workbench/runs/<runId>/qmo-summary.md | pbcopy   # macOS
```

GitHub PR / Slack に貼ると section 化された Release Readiness Summary になります。

---

## 6.x E2E で動作確認 (このプロジェクト内で完結)

このリポジトリは Phase 1.2 の Allure 統合パイプラインを **このプロジェクトの
fixture (`tests/fixtures/sample-pw-allure-project/`)** に対して回す
end-to-end test を備えています。新規参加者が GUI 操作を一切手作業で
やらずに「Workbench が動く」ことを確認できる経路です。

```bash
# 1. workspace 全体の依存をインストール (fixture も含む)
pnpm install --frozen-lockfile

# 2. Chromium を取得 (初回のみ)
pnpm --filter @pwqa-e2e/workbench-gui exec playwright install chromium

# 3. ターミナル A — Workbench を起動 (fixture 親 dir を allowlist に)
WORKBENCH_ALLOWED_ROOTS=$(pwd)/tests/fixtures pnpm dev:agent &
pnpm dev:web &

# 4. ターミナル B — Allure pipeline E2E を実行
pnpm e2e:allure
```

何を検証しているか:

1. プロジェクトオープン (`tests/fixtures/sample-pw-allure-project`) →
   ProjectFacts が pnpm + allure-playwright を検出
2. TestInventoryPanel に fixture の 2 spec が表示
3. **Run** ボタン → run 完了 (fixture には意図的な failing test が 1 件あるため
   status=failed)
4. QMO Summary Banner に `outcome=Not Ready` が表示される
5. Quality Gate 行 (`QG: failed (...)`) が表示される

CI でも同じ E2E が実行されます (`GUI E2E (Allure pipeline)` step、
`.github/workflows/ci.yml`)。失敗時は `e2e/_artifacts/` に
スクリーンショットが残ります。

## 7. HTTP API リファレンス (PoC 範囲)

| Method | Path | 用途 |
|---|---|---|
| GET | `/health` | health check (`{ ok, service, version, timestamp }`) |
| POST | `/projects/open` | `{ rootPath, packageManagerOverride? }` で project scan + open |
| GET | `/projects/current` | 現在 open 中の `ProjectSummary` |
| GET | `/projects/:projectId/inventory` | spec / test inventory (`playwright test --list --reporter=json`) |
| POST | `/runs` | `RunRequest` で run 開始 (202 + `{ runId, metadata }`) |
| GET | `/runs` | run 一覧 (active + persisted の merge) |
| GET | `/runs/:runId` | 単一 run の `RunMetadata` |
| POST | `/runs/:runId/cancel` | run キャンセル (active のみ) |
| GET | `/runs/:runId/artifacts` | artifact 存在判定 (`hasPlaywrightJson` 等) |
| GET | `/runs/:runId/report-summary` | `TestResultSummary` の compact view |
| GET | `/runs/:runId/qmo-summary` | **T208-1**: QmoSummary JSON |
| GET | `/runs/:runId/qmo-summary.md` | **T208-1**: QmoSummary Markdown |
| WS | `/ws` | run.queued / run.stdout / run.stderr / run.completed 等の event stream |

curl 例:

```bash
# project を開く
curl -sX POST http://127.0.0.1:4317/projects/open \
  -H 'Content-Type: application/json' \
  -d '{"rootPath": "/Users/me/projects/my-pw-app"}'

# run 一覧
curl -s http://127.0.0.1:4317/runs | jq

# QMO summary を Markdown で取得
curl -s http://127.0.0.1:4317/runs/<RUN_ID>/qmo-summary.md
```

---

## 8. トラブルシューティング

### "Run blocked: ..." (409 RUN_BLOCKED)

PackageManagerDetector がブロック判定。原因と対処:

| 原因 | 対処 |
|---|---|
| `@playwright/test` が `package.json` 未記載 | `npm install --save-dev @playwright/test` |
| 複数 lockfile (`package-lock.json` + `pnpm-lock.yaml`) | 不要な lockfile を削除、または `packageManager` field を `package.json` に追記 |
| Bun 検出 (`bun.lockb`) | Phase 1.5 までブロック設計。npm/pnpm/yarn に切替 |
| `node_modules/.bin/playwright` が無い | `pnpm install` / `npm install` を再実行 |

### Allure HTML が生成されない

- `<runDir>/allure-results/` が空: copy step がスキップされた → run 中に `<projectRoot>/allure-results/` に何も書き込まれていない
  - **要因**: `allure-playwright` reporter が `playwright.config.ts` に未追加 / `resultsDir` が `ProjectScanner` で検出できない動的値 / test が 0 件
- `<runDir>/allure-results/` はあるが `<runDir>/allure-report/` が無い:
  - `metadata.warnings` を確認。`Allure CLI not found` なら project に `allure` (Allure 3 CLI) が install されていない → `npm install --save-dev allure@~3.6.2`

### Quality Gate が常に skipped

- `quality-gate-result.json` 不在: 同様に Allure CLI 未 install or 空 results
- `failureMode: "no-results"` warning が `metadata.warnings` に出ていれば確定

### `WORKBENCH_ALLOWED_ROOTS` を設定したのに 403 PROJECT_NOT_ALLOWED

`realpath` ベースで照合します。symlink を含む path は事前に `realpath` 解決した値を `:` 区切りで指定:

```bash
WORKBENCH_ALLOWED_ROOTS=$(realpath /Users/me/projects/my-pw-app):$(realpath /Users/me/projects/other) pnpm dev:agent
```

### secret が ログ / 結果に流出していないか

PLAN.v2 §28 / Issue #27 に従い:
- `playwright-results.json` は redaction 済 (PR #2 / `redactWithStats`)
- structured log は `errorLogFields` の fail-closed default で `error.message` を drop
- subprocess stdout/stderr は redact 経由で WS 配送
- ヘルパー warning は basename + stable error code のみ (絶対 path 含めない)

問題があれば issue 起票推奨。

---

## 9. 既知の制約 (PoC 段階)

詳細な残作業は [`./poc-remaining-work.md`](./poc-remaining-work.md) を参照してください。代表的な PoC 段階の制約:

- **`/qmo` route は最新 1 run の banner のみ**: run-by-run 切替 UI は Phase 6
- **InsightsView 本体は placeholder**: 上部の banner だけ live
- **Allure resultsDir 動的検出非対応**: `process.env.X` や三項式は extract できない
- **Windows 対応外**: macOS / Linux 限定
- **Tauri 配布なし**: `npx playwright-workbench` は未配布。リポジトリ clone 前提
- **AI 機能なし**: AI Adapter は Phase 3 / Phase 9
- **trace / screenshot / video viewer なし**: GUI 内 artifact viewer は Phase 2 以降

---

## 10. 参考

- 全体計画: [`PLAN.v2.md`](../../PLAN.v2.md)
- 各タスク設計メモ: `docs/design/`
- Phase 1.2 完了報告: [`IMPLEMENTATION_REPORT.md`](../../IMPLEMENTATION_REPORT.md)
- Allure Report 3 公式: <https://allurereport.org/docs/v3/>
- Playwright 公式: <https://playwright.dev/>
