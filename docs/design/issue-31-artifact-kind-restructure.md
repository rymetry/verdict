# Issue #31: ArtifactKind を identity + operation 軸に再構成 (Phase 1.2 prep)

## 目的

Phase 1.2 (Allure Report 3 統合) 着手前に、`apps/agent/src/lib/structuredLog.ts` の `ArtifactKind` closed union が **identity** (`playwright-json`, `stdout-log`) と **operation** (`playwright-json-redaction`, `stream-redaction`, `playwright-json-summary`) を混合した flat 構造である現状を解消する。

Phase 1.2 で Allure を追加すると `O(reporter × operation)` で union が膨張し、メンバー追加のたびに type-level regression test (Issue #30 項目 A で凍結) を更新する必要が出る。Phase 1.2 着手前にスキーマを直交化することで、Allure 追加時の変更面を identity 軸の追加 (`allure-results` / `allure-report` / `allure-exports`) のみに限定できる。

PLAN.v2.md §28 (Security Model) の secret/path redaction 方針 + §38 Phase 1.2 prompt 群との橋渡し。Issue #30 (項目 A の type-level regression、項目 C の canonical path 統一) が前提。

## スコープ

- 対象:
  - 型定義: `apps/agent/src/lib/structuredLog.ts` の `ArtifactKind` を identity-only に縮小、`ArtifactOperation` を新設
  - ログ呼び出し移行: `apps/agent/src/playwright/runManager.ts` (5 箇所)、`apps/agent/src/playwright/streamRedactor.ts` (2 箇所)
  - テスト移行: `apps/agent/test/runManager.test.ts` (10 箇所程度)、`apps/agent/test/structuredLog.test.ts` の type-level regression
  - ドキュメント: `docs/design/phase-1-5-warning-observability.md` の構造化ログ schema 変更履歴に Phase 1.7 → Phase 1.2 prep 移行を追記
- 非対象:
  - Phase 1.2 本体 (Allure 統合) — 別 task
  - Allure identity (`allure-results` / `allure-report` / `allure-exports`) を **本 PR では追加しない**。Phase 1.2 着手時の追加面を最小化することが目的なので、本 PR は既存メンバーの再構成のみに留める。
  - log aggregator query 互換シム — 既存の path-redaction 系 query は `artifactKind` ベースで既に動いているため、追加の compat layer は不要 (issue 受け入れ条件 「query 影響を最小化」 を満たすため、scheme 変更を 1 度に集約する)。

## アプローチ

### 新しい型定義

```ts
// identity 軸: artifact 自体の種別
export type ArtifactKind =
  | "playwright-json"
  | "playwright-html"     // 旧 "html-report" を rename(Allure HTML との衝突回避 + identity 名規則統一)
  | "stdout-log"
  | "stderr-log"
  | "metadata"
  | "runs-directory"
  | "audit-log";

// operation 軸: その artifact に対して行った処理 (任意)
export type ArtifactOperation =
  | "redaction"
  | "summary-extract"
  | "stream-redaction";
```

logger payload は `{ artifactKind: ArtifactKind, op?: ArtifactOperation }` の 2 フィールド構成へ。`op` は省略可能 (artifact 自身に対する操作ではなく artifact が "存在する" イベント — 例: `runs-directory` 作成失敗 — では op を付けない)。

### 旧→新マッピング表

| 旧 `artifactKind` | 新 `artifactKind` | 新 `op` | 備考 |
|---|---|---|---|
| `playwright-json` | `playwright-json` | (省略) | identity そのまま |
| `playwright-json-redaction` | `playwright-json` | `redaction` | redaction operation 切り出し |
| `playwright-json-summary` | `playwright-json` | `summary-extract` | summary 抽出 operation |
| `stdout-log` | `stdout-log` | (省略) | log write failure 時(identity 損失) |
| `stderr-log` | `stderr-log` | (省略) | 同上 |
| `metadata` | `metadata` | (省略) | run metadata 操作 |
| `html-report` | `playwright-html` | (省略) | rename。Phase 1.2 の `allure-report` と並んで複数 reporter HTML を区別できるよう identity 名を直交化 |
| `stream-redaction` | `stdout-log` または `stderr-log` | `stream-redaction` | stream 実体に operation を載せる。既存の `stream` field と冗長になるため `stream` field は削除 |
| `runs-directory` | `runs-directory` | (省略) | identity そのまま |
| `audit-log` | `audit-log` | (省略) | identity そのまま |

#### `html-report` → `playwright-html` の rename 判断

**変更理由**: Phase 1.2 で `allure-report` (Allure HTML) を追加すると、`html-report` という汎用名は曖昧になる。reporter 固有 prefix (`playwright-` / `allure-`) を identity に載せておくことで、Phase 1.2 の identity 追加が機械的になる。

**影響範囲**: 現状コードベース全体で `html-report` を実際に emit しているのは `runManager.ts` の 0 箇所 (型定義のみ存在し、実利用なし)。`structuredLog.ts:39` の closed union メンバーとして残っているが、本変更で union メンバーから外して `playwright-html` に置換する。**実 emission がないため log aggregator query 互換性への影響もない**。

#### `stream-redaction` 移行の詳細

旧 (streamRedactor.ts:49):

```ts
logger?.error(
  {
    runId,
    stream,                                          // "stdout" | "stderr"
    artifactKind: "stream-redaction" satisfies ArtifactKind,
    code,
    errorName: ...
  },
  "run stream redaction failed"
);
```

新:

```ts
logger?.error(
  {
    runId,
    artifactKind: stream === "stdout" ? "stdout-log" : "stderr-log",
    op: "stream-redaction",
    code,
    errorName: ...
  },
  "run stream redaction failed"
);
```

`stream` field は identity (`stdout-log` / `stderr-log`) に統合されるため削除。これにより 1 イベントに 1 つの primary correlation key (artifactKind) しか持たない原則が保たれる。log aggregator query: 旧 `stream:"stdout" AND artifactKind:"stream-redaction"` → 新 `artifactKind:"stdout-log" AND op:"stream-redaction"`。

### 型レベル regression test の更新

`apps/agent/test/structuredLog.test.ts` の `expectTypeOf<ArtifactKind>` を identity-only set に絞る。`expectTypeOf<ArtifactOperation>` も追加。

```ts
expectTypeOf<ArtifactKind>().toEqualTypeOf<
  | "playwright-json"
  | "playwright-html"
  | "stdout-log"
  | "stderr-log"
  | "metadata"
  | "runs-directory"
  | "audit-log"
>();

expectTypeOf<ArtifactOperation>().toEqualTypeOf<
  | "redaction"
  | "summary-extract"
  | "stream-redaction"
>();
```

## 検討した代替案

- **A. 完全置換でなく Discriminated Union** (`type ArtifactRef = { kind: "playwright-json"; op?: "redaction" | "summary-extract" } | ...`) は型安全性が最高だが、`{ artifactKind, op? }` を別フィールドで logger payload に展開する既存構造と相性が悪い (object spread でメンバー散逸)。**非採用**。
- **B. 旧メンバーを deprecated として残し並行運用** は scheme 変更を 1 度に集約する受け入れ条件と矛盾。型安全性も低下するため **非採用**。
- **C. operation を sub-namespace で命名規則化** (例: `playwright-json/redaction`) は人間可読だが log aggregator query の facet として扱いにくい。2 フィールド分離の方が標準的 ELK / Datadog などでフィルタしやすい。**非採用**。
- **D. `html-report` をそのまま残す** (rename しない) も検討したが、Phase 1.2 で `allure-report` 追加時に名前 conflict が発生し、その時点で結局 rename する。前倒しが合理的。**非採用**。

## 影響範囲

- 変更ファイル:
  - `apps/agent/src/lib/structuredLog.ts` (型定義 — `ArtifactKind` 縮小 + `ArtifactOperation` 追加)
  - `apps/agent/src/playwright/runManager.ts` (~5 箇所の `satisfies ArtifactKind` 置換)
  - `apps/agent/src/playwright/streamRedactor.ts` (2 箇所、`stream` field 削除)
  - `apps/agent/test/structuredLog.test.ts` (type-level regression 2 union 化)
  - `apps/agent/test/runManager.test.ts` (10 箇所程度の assertion 更新 — `artifactKind: "playwright-json-redaction"` → `artifactKind: "playwright-json", op: "redaction"`)
  - `apps/agent/test/server.test.ts` (audit-log assertion は影響なし、stream-redaction 検査箇所のみ更新)
  - `docs/design/phase-1-5-warning-observability.md` (schema 変更履歴追記)
- 既存機能への影響: なし (構造化ログのフィールド shape 変更のみ。UI/API には出ない)
- マイグレーション要否: log aggregator 設定があれば query を新スキームに更新 (issue 受け入れ条件で許容)

## テスト方針

- 型レベル: `expectTypeOf<ArtifactKind>` を新セットで凍結、`expectTypeOf<ArtifactOperation>` も同様に凍結
- 既存 path-leak テスト (`runManager.test.ts:394, 1162`, `server.test.ts:511, 524, 578, 812`) は payload shape 変更後も同等の絶対パス不在を保証
- 新規テスト: `runManager.test.ts` で `op` field が正しく載ることを 2-3 箇所で明示的に検証 (例: redaction failure → `op: "redaction"`)
- `pnpm typecheck && pnpm test` の double check

## リスクと緩和策

- **リスク**: ログ aggregator (もし運用中なら) 旧 `artifactKind` 値での query が壊れる
  - **緩和**: PoC 段階で aggregator 構成は未確立 (PLAN.v2 §29 で「PoC でクラウド/DB なし」)。本 PR の commit message と設計メモで schema 変更を明示し、Phase 1.2 着手時の Allure identity 追加と合わせて 1 段階で query 切り替えできるようにする。
- **リスク**: `stream` field 削除で既存 dashboard が空欄化
  - **緩和**: 上に同じ。`stream-redaction` 経路の `stream` field は emit から消えるが `artifactKind: "stdout-log" | "stderr-log"` で同等以上の情報量を保つ。
- **リスク**: `op` field の任意性で「op を付け忘れた」事故が起きる
  - **緩和**: TypeScript 型では `op?` は optional のまま (= 識別子だけのイベントを許容)。Phase 1.2 以降に operation の網羅 lint を入れるかは別議論。本 PR では型で `ArtifactOperation` の値域を凍結することで、誤った operation 文字列の混入は防ぐ。
- **リスク**: `playwright-html` への rename で stale 参照が残る
  - **緩和**: 旧 `html-report` の grep を実施し、union メンバーから外したコンパイル時に全参照が顕在化することを TypeScript の closed-union ルールで保証 (現状 emit 0 箇所と確認済み)。

## 想定外の判断ポイント

- `metadata` 識別子を operation 軸に分けるか? — 例えば metadata 書き込み失敗 (`runManager.ts:724/737/753`) は "metadata 自身が壊れた" のか "metadata 書き込み operation が失敗した" のか曖昧。**判断**: identity (`metadata`) のままにする。これは run 全体の metadata.json という 1 つの artifact identity であり、書き込み操作は artifact 自身のライフサイクルとして扱える (file-creation = identity の存在自体)。`op` を付けないことで「artifact identity 操作」と「artifact 上の派生 operation」 (redaction/summary) を区別できる。
- `runs-directory` も同様の判断。directory 作成失敗 = identity 自身のライフサイクル失敗とみなす。

## 失敗カウンタ

- phase_4_5_failure_count: 0
- pr_merge_failure_count: 0
