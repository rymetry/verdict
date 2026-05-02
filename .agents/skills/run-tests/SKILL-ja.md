---
name: run-tests
description: Verdict の test suite を実行・解釈・拡張するときに使う。Vitest unit / integration、GUI smoke、Allure pipeline E2E の全層をカバーし、feature 開発中の高速 feedback loop の絞り方も記述する。
---

# テストを実行・解釈する

> EN: [`SKILL.md`](SKILL.md) (英語版が SoT、本書は理解補助)

Verdict には 3 層の test がある。それぞれ目的と実行コストが異なる。

## 層

| 層 | ツール | 場所 | 典型実行時間 | いつ走らせるか |
|---|---|---|---|---|
| Unit / Integration | Vitest | `apps/agent/test/`, `apps/web/test/` | 絞り込み 5-15 秒、フル ~1 分 | 保存ごと (絞り込み)、commit 前 (フル) |
| GUI smoke | Playwright via `e2e/` | `e2e/tests/` | ~1-2 分 | UI 触る PR を push する前 |
| Allure pipeline E2E | Playwright + Allure | `e2e/tests/` (`smoke:allure`) | ~2-3 分 | Allure pipeline を触る PR を push する前 |

## 日常コマンド

```bash
# モノレポ全体の型チェック (refactor 時の高速 feedback)
pnpm typecheck

# agent + web の全 unit + integration test
pnpm test

# build (稀; dist 出力を validate するときくらい)
pnpm build

# GUI smoke (dev サーバ起動して GUI shell を exercise)
pnpm smoke:gui

# Allure pipeline E2E full (sample-pw-allure-project fixture を使用)
pnpm smoke:gui:allure
```

## 単一ファイルの fast loop

agent の特定ファイルを iterate しているときは、test を絞る:

```bash
pnpm --filter @pwqa/agent test -- runManager
```

`runManager` を path に含む test ファイルだけを走らせる。web も同様:

```bash
pnpm --filter @pwqa/web test -- run-console
```

post-write hook (`.codex/hooks/post-tool-use-typecheck.sh`) が保存時に typecheck を走らせる。手動で呼ぶ必要はないことが多い。

## 失敗の解釈

### Vitest

- 失敗は単一 test case。diff が inline 表示されるので actual vs expected をコピーしてトリアージする。
- `expect(...).toMatchSnapshot()` 失敗: 新 snapshot が意図したものか **`--update` する前に** 検証。データに構造的意味があるとき snapshot-by-default は code smell。
- schema 編集後の `Cannot find module '@pwqa/shared'`: `pnpm --filter @pwqa/shared build` を忘れている。

### GUI smoke

- 失敗時、screenshot が `e2e/test-results/` に保存される。
- Playwright が失敗ごとに `trace.zip` を生成。`pnpm exec playwright show-trace <path>` で開いて step through する。
- "Could not find data-testid" → panel が rename されたが test 未更新、もしくは panel が test 対象 persona route に mount されていない。

### Allure pipeline E2E

- `tests/fixtures/sample-pw-allure-project/` 下の fixture が test 対象。
- `runs/<runId>/` の artifact は inspection 用に保持される。`metadata.json` と `quality-gate-result.json` を最初に見る。
- "playwright-report not produced" → project の `playwright.config.ts` に `json` reporter がない。fallback (`materializePlaywrightJsonSafely`) が起動するはず。起動しない場合は `playwrightJsonWarnings` を確認。

## test の追加

### Vitest unit test

1. `<area>.test.ts` を `apps/agent/test/` または `apps/web/test/` の source 隣に作る。
2. `describe` を test 対象 symbol、`it` を behavior に。behavior 表現: `should <observable behavior>` (英語)。
3. happy path + 少なくとも 1 つの failure mode をカバー。path-emitting コードでは absolute-path 入力 → relative-output assertion をカバー (`.agents/rules/path-safety-ja.md` 参照)。
4. 外部依存 (file system、network) は最低限の層でのみ mock。深い mock より real `tmpdir`-based test が望ましい。

### Vitest integration test

agent の複数モジュールを end-to-end で exercise する場合:

- 隔離 workspace に `mkdtempSync(path.join(os.tmpdir(), "pwqa-..."))` を使う。
- 外部コマンドは `unsafelyAllowAnyArgsValidator` policy + `node` shim script で stub する (`apps/agent/test/runManager.test.ts` がパターン参考)。
- 必ず `afterEach` で cleanup; suite を reentrant に保つ。

### GUI smoke test

- `e2e/tests/` の既存 test factory を使う。
- `data-testid` で driving。testid が存在する場所では CSS selector や text-content assert を避ける。
- ユーザに見えるフローのみ追加 (内部挙動は Vitest test の領域)。

## カバレッジ期待値

ユーザーグローバル rule は 80%+ カバレッジを義務付け。Verdict での具体:

- 新規 agent コード: happy path + 最も起こりやすい failure mode + path / secret / shell 境界の unit + integration test。
- 新規 web feature: loading / empty / error / success state の unit / integration test。
- 新規 GUI smoke: ユーザに見えるフローでかつ unit / integration test がカバーしていない場合のみ追加。

カバレッジは CI の `verify` job で enforce。閾値を割る PR は flag される。

## 禁止事項

- PLAN.v3 の follow-up T-task なしに `it.skip` / `it.todo` で skip する。
- 任意の test から実外部サービス (real GitHub API、real Stripe、real Anthropic) を呼ぶ。境界で mock するか、(配線済みなら) project の MSW 層を使う。
- snapshot を盲目的に更新する。diff を先に inspect。
- システム timing 依存の "flaky" assertion。Playwright の web-first assertion (`toHaveURL`, `toBeVisible`) を `waitForTimeout` より優先。

## 関連

- `.agents/rules/code-style-ja.md` — 保守性のある test の書き方。
- `apps/agent/test/runManager.test.ts` — tmpdir-based agent integration test の reference。
- `apps/web/test/features/run-console.test.tsx` — cancel-button フロー test の reference。
- `e2e/tests/` — GUI smoke fixture の reference。
