# T201: Allure 検証用 fixture project (Phase 1.2 prep)

## 目的

Phase 1.2 (T202 以降) で `AllureReportProvider` 抽象 + Playwright run pipeline の Allure 統合 + Quality Gate を実装するため、**実際に Allure 出力を生成できる Playwright project** を `tests/fixtures/` に追加する。`tests/fixtures/sample-pw-project/` (Phase 1 用) は `--list` 系のみで browser 起動も Allure もないので、Phase 1.2 用の別 fixture を新設する。

T200 (Allure investigation memo) で確定した内容に基づき、`allure-playwright@^3.7.1` + `allure@^3.6.2` を pin する。

## スコープ

- 対象:
  - 新規 fixture: `tests/fixtures/sample-pw-allure-project/`
  - `package.json` (devDependencies: `@playwright/test`, `allure-playwright`, `allure`)
  - `playwright.config.ts` (reporter に `allure-playwright` 追加 + `resultsDir` 明示)
  - サンプル `tests/example.spec.ts` (1 件 passing + 1 件 failing。known-issue / quality-gate のテスト用)
  - `.allurerc.mjs` (Allure 3 設定 — `historyPath` JSONL、`output` 指定、log plugin 有効化)
  - `pnpm-lock.yaml` 更新 (新 fixture の deps を含める)
- 非対象:
  - `AllureReportProvider` 実装 (T202)
  - Workbench 側 pipeline 統合 (T203)
  - Allure CLI を実機で起動する integration test (Phase 1.2 内で T204 に近づいた段階で追加)

## アプローチ

### fixture 構造

```
tests/fixtures/sample-pw-allure-project/
├── package.json              # @playwright/test, allure-playwright, allure 各 pin
├── playwright.config.ts      # reporter に list + json + allure-playwright
├── .allurerc.mjs             # historyPath, output, plugins.log
├── allure-results/           # gitignore (allure-playwright が書き込む)
├── allure-report/            # gitignore (allure CLI が書き込む)
└── tests/
    └── example.spec.ts       # passing + failing の混在
```

### dependencies

T200 で確定した npm 上の latest stable:

- `@playwright/test`: 既存 fixture と揃えて `^1.55.0`
- `allure-playwright`: `^3.7.1` (Allure 3 系の最新)
- `allure`: `^3.6.2` (Allure 3 系 CLI の最新)

`allure-commandline` (Allure 2) は **依存に入れない**。Phase 1.2 startup check で衝突検出する設計の前提を保つ。

### `playwright.config.ts`

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  reporter: [
    ["list"],
    ["json", { outputFile: "playwright-results.json" }],
    ["allure-playwright", {
      resultsDir: "allure-results",
      detail: true,
      suiteTitle: true,
    }],
  ],
  use: {},
});
```

`resultsDir` を **explicit** に書いておくのがポイント。Workbench の ProjectScanner ヒューリスティック検出が動的 config の場合に失敗する仕様 (T200 投資調査メモ) に対し、本 fixture は **静的 string literal** で書いて検出可能にしておく。

### `.allurerc.mjs`

```js
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
```

`historyPath` は JSONL 単一ファイル形式 (T200 で確定)。`plugins.log` と `plugins.csv` は AI/QMO summary 用 (T207 が読む)。

### サンプル test

`tests/example.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("trivial passing assertion @smoke", async () => {
  expect(1 + 1).toBe(2);
});

test("intentionally failing assertion for quality-gate demo", async () => {
  // この test は Phase 1.2 で意図的に fail させ、quality-gate / known-issues
  // / Workbench failure review の動線を確認する。
  expect(1 + 1).toBe(3);
});
```

failing test を残す理由: T204 (Allure HTML 生成) と T205 (Quality Gate) の検証で「実際に失敗した results が存在する」状態が必要。Phase 1.2 が完了すれば、failing test は known-issue として `known-issues.json` に登録するか、別 spec に分離する判断は Phase 1.2 締め時点で行う。

### `.gitignore`

fixture 直下に `.gitignore` を追加し、`allure-results/`, `allure-report/`, `allure-history.jsonl`, `playwright-results.json` を ignore。run のたびに生成される artifact をリポジトリに含めない。

## 検討した代替案

- **A. 既存 `sample-pw-project/` に Allure を追加** — 反対。`sample-pw-project/` は Phase 1 integration smoke (`--list` のみ) で使われており、Allure を追加すると CI 上の install 時間や `node_modules` 肥大化が他テストにも波及。**fixture を分けることで T200 確認内容を独立に検証可能**にする。
- **B. `allure-playwright` のみ追加し `allure` CLI は将来 install** — 反対。T202 で provider 実装するために CLI 実機 sanity check (T200 で「実装着手前に 1 度実行」と記載) が必要。CLI を fixture 内に pin する方が再現性が高い。
- **C. failing test を含めない** — 反対。T204/T205 で Quality Gate 動作確認のために failure data が必須。

## 影響範囲

- 新規ディレクトリ: `tests/fixtures/sample-pw-allure-project/`
- `pnpm-lock.yaml` 更新 (新 deps 取り込み)
- 既存機能への影響: なし (新 fixture 追加のみ)
- CI 影響: `pnpm install` で `allure-playwright` + `allure` の追加 install が発生 (微増)
- `tests/fixtures/sample-pw-project/` は変更しない

## テスト方針

T201 単体ではテスト追加なし。Phase 1.2 後続タスク (T203/T204/T205) で本 fixture を入力にした integration test が追加される。

ただし以下を T201 PR 内で検証:

- `pnpm install --frozen-lockfile` が成功する (lockfile 整合)
- `pnpm typecheck` が agent / web / shared で破綻していない
- 既存 `pnpm test` の全 207+348 テストが green を維持
- 既存 integration smoke (`apps/agent/test/integration/fixtureProject.test.ts`) が引き続き sample-pw-project を使い green を維持
- `pnpm --filter @pwqa-fixture/sample-pw-allure-project run list` が動く (新 fixture が `playwright test --list --reporter=json` を実行できる)

## リスクと緩和策

- **リスク**: `allure` CLI の追加 install で CI 時間が大きく延びる
  - **緩和**: 単 package で 3MB 程度 (npm 上の dist-size 確認では 8.7 MB unpacked、許容範囲)。`allure-playwright` も Node-only。Java sidecar なし
- **リスク**: `allure-playwright@3.x` と既存 `@playwright/test@1.55.x` の互換性問題
  - **緩和**: T200 調査時点で公式 docs に Playwright 1.55 サポートが明記。万一 incompat なら fixture 内で specific minor pin に下げる
- **リスク**: failing test が CI を red にする
  - **緩和**: 本 fixture の test は **fixture 内部で `pnpm test` から呼ばれない**。Workbench が runtime に呼ぶ専用 fixture。CI の root `pnpm test` は `apps/*` `packages/shared` のみ
- **リスク**: `allure` v3 の API/CLI が beta から GA への移行直後で不安定
  - **緩和**: T200 で `allure@3.6.2` (GA) を確認済み。問題発生時は version pin を `~3.6.0` に固定してマイナー不安定を避ける

## 想定外の判断ポイント

- `allure-playwright` 配下の `attachments` 機能 (`testInfo.attach` が allure-results に流れる) は本 fixture では明示的に使わない。Phase 1.2 で `AllureReportProvider` がそれをどう扱うかは T202 で別途検討
- `.allurerc.mjs` か `.allurerc.js` か `.allurerc.ts` か: ESM サポート + Node 24 ネイティブ TS は不安定なので `.mjs` を選択

## 失敗カウンタ

- phase_4_5_failure_count: 0
- pr_merge_failure_count: 0
