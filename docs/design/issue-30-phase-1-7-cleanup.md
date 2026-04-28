# Issue #30: Phase 1.7 cleanup — type-level test + test helper + lib migration polishing

## 目的

PR #28 / #29 の specialized reviewer 3 種共通 NTH 指摘を集約解消。Phase 1.7 で `lib/structuredLog.ts` に集約した path-redaction 関連 API の hygiene を仕上げ、Phase 1.2 (Allure 統合) 着手前にコードベースを整える。

PLAN.v2.md §28 (Security Model) の secret/path redaction 方針と §38 Phase 1.2 prompt 群との橋渡し。

## スコープ

- 対象:
  - 項目 A: `apps/agent/test/structuredLog.test.ts` に `ArtifactKind` 型レベル regression
  - 項目 B: `apps/agent/test/helpers/leakAssertions.ts` 新規作成 + 4 箇所(runManager.test.ts × 2, server.test.ts × 2)の移行
  - 項目 C: `apps/agent/src/playwright/runTypes.ts` の `lib/structuredLog.js` 再エクスポート削除 + 残存呼び出し(runManager.ts, streamRedactor.ts)の canonical path 移行
  - 項目 D: `apps/agent/src/server.ts` の `main()` で `createLogger` を 1 回だけ呼び、`buildApp({ env, logger })` に伝播
- 非対象:
  - Issue #31 (`ArtifactKind` を identity + operation 軸に再構成) — 別 PR
  - Phase 1.2 Allure 統合本体
  - 既存テストの内容変更(helper 抽出による文言・assertion semantics の変更は禁止)

## アプローチ

### 項目 A: 型レベル regression テスト

`vitest` の `expectTypeOf` を使い、`ArtifactKind` の **closed union メンバー集合** を凍結する。
新メンバー追加時(=Phase 1.2 で `allure-results` 等を入れる時)はこのテストを意図的に更新する作業が必要になり、widening 事故を防ぐ。

```ts
expectTypeOf<ArtifactKind>().toEqualTypeOf<
  | "playwright-json"
  | "playwright-json-redaction"
  | ...
>();
```

### 項目 B: `expectNoPathLeak(payloads, paths, opts?)` helper

既存コードの実態調査 (2026-04-29 grep) で **真の duplication は 2 箇所** と判明:

- `runManager.test.ts:394-399`: `JSON.stringify(errors).not.toContain(path1)` × 2 + `for (const entry of errors) entry.not.toHaveProperty("err")`
- `runManager.test.ts:1166-1172`: 同パターン + 追加 forbidden key (`playwrightJsonPath`)

`server.test.ts` 内の `not.toHaveProperty("err")` 出現箇所 (3 箇所: L510/578/812) は **`errors.find(...)` で抽出した単一エントリ** に対する単発 assertion で、`for-of` 全件チェックパターンとは shape が異なる。これらを共通 helper で表現すると引数が肥大化し、`<minimize_overengineering>` (1 回しか使わない処理のため抽象化を作らない) に違反する。よって本 PR は **for-of 全件チェックを使う 2 箇所** のみ移行する。

helper 実装:

```ts
// apps/agent/test/helpers/leakAssertions.ts
export function expectNoPathLeak(
  payloads: ReadonlyArray<Record<string, unknown>>,
  paths: readonly string[],
  options: { forbiddenKeys?: readonly string[] } = {}
): void {
  const forbiddenKeys = options.forbiddenKeys ?? ["err"];
  const json = JSON.stringify(payloads);
  for (const p of paths) {
    expect(json).not.toContain(p);
  }
  for (const entry of payloads) {
    for (const key of forbiddenKeys) {
      expect(entry).not.toHaveProperty(key);
    }
  }
}
```

利用例:

```ts
// 旧 runManager.test.ts:394-399
expectNoPathLeak(errors, ["/private/stdout.log", "/private/stderr.log"]);

// 旧 runManager.test.ts:1166-1172 (forbidden key 拡張)
expectNoPathLeak(errors, [completed.paths.playwrightJson, workdir], {
  forbiddenKeys: ["err", "playwrightJsonPath"],
});
```

`forbiddenKeys` のデフォルトは `["err"]` のみ。明示時は完全置換(累積ではない)とすることで、呼び出し側が「何が禁止されているか」を一目で把握できる。

### 項目 C: `runTypes.ts` 再エクスポート削除

`git grep "from.*runTypes" apps/agent/src` で残存呼び出しを特定 → `from "../lib/structuredLog.js"` に置換 → re-export 削除。
`RunManagerLogger` と `StreamRedactor` interface は引き続き `runTypes.ts` 自身が canonical 定義として持ち、削除しない(これらは run-lifecycle 固有概念であり `lib/` の generic helper ではない)。

### 項目 D: `main()` の logger 統一

```ts
async function main(): Promise<void> {
  const env = buildAgentEnv({ argv: process.argv.slice(2) });
  const logger = createLogger(env.logLevel);
  const { app, injectWebSocket } = buildApp({ env, logger });
  // ...
}
```

`buildApp` シグネチャは既存の `BuildAppOptions.logger` を活用するのみ(変更不要)。
`logger.info` 呼び出しは production logger の場合 `info()` を呼ぶが、`createLogger` が pino を返しテストの `RunManagerLogger` も `info?` を実装しているため互換性に問題なし。

## 検討した代替案

- **A** は `it.todo` でも目的を達成可能だが、CI で型変更が検知されないので非採用。
- **B** で flag 引数を採用すると `expectNoPathLeak(payloads, paths, { allowErr: true })` のような呼び出しになり、Tell-Don't-Ask 違反 + ブール引数フラグ回避(coding-style.md)に反するため非採用。
- **C** で `runTypes.ts` を完全削除する案は `RunManagerLogger` / `StreamRedactor` の置き場所を別途決める必要があり、本 PR スコープを膨らませるため非採用。
- **D** で `BuildAppOptions.logger` を required に変更する案は API 破壊が大きく、テスト全件の修正を要するため非採用(現状の optional + ?? fallback で十分)。

## 影響範囲

- 変更ファイル:
  - `apps/agent/test/structuredLog.test.ts` (項目 A 追記)
  - `apps/agent/test/helpers/leakAssertions.ts` (新規, 項目 B)
  - `apps/agent/test/runManager.test.ts` (項目 B 移行 ×2)
  - `apps/agent/test/server.test.ts` (項目 B 移行 ×2)
  - `apps/agent/src/playwright/runTypes.ts` (項目 C 再エクスポート削除)
  - `apps/agent/src/playwright/runManager.ts` (項目 C import path 変更)
  - `apps/agent/src/playwright/streamRedactor.ts` (項目 C import path 変更)
  - `apps/agent/src/server.ts` (項目 D `main()` 変更)
- 既存機能への影響: なし(挙動変更なし、内部 hygiene のみ)
- マイグレーション要否: なし

## テスト方針

- 項目 A: `expectTypeOf` の type-level assertion(コンパイル成功 = pass)
- 項目 B: 既存 4 箇所のテストが green を維持(helper 抽出は挙動保存)
- 項目 C: 既存テストが green を維持(`pnpm test`)
- 項目 D: `apps/agent/test/server.test.ts` の logger spy 経路テストが green を維持
- 全体: `pnpm typecheck && pnpm test` の double check

## リスクと緩和策

- リスク: 項目 B の helper 抽出で assertion semantics が変わる(例: stringify 対象が異なる) → 緩和: helper を thin に保ち、移行前後の test diff を最小化。helper 内で対象 path を **個別にチェック**(配列内ループでなく単発)し既存の `not.toContain` と等価にする。
- リスク: 項目 C 削除後に IDE/linter の自動補完経路が変わって import が壊れる → 緩和: `pnpm typecheck` を必ず通す。
- リスク: 項目 D で `buildApp({ env })` 呼び出し側(テスト含む)が `logger` 省略時 fallback 経路を使えなくなる → 緩和: `BuildAppOptions.logger` は引き続き optional 維持、main() 経路だけ optional → 渡すように変更。

## 想定外の判断ポイント

なし(設計が小粒で枝分かれが少ない)。

## 失敗カウンタ

- phase_4_5_failure_count: 0
- pr_merge_failure_count: 0
