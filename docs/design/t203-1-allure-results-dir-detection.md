# T203-1: ProjectScanner で playwright.config から allureResultsDir を検出

## 目的

T203 (Allure 統合 run pipeline) の最初のサブタスク。`tests/fixtures/sample-pw-allure-project/playwright.config.ts:18-23` のような **静的 string literal で書かれた `resultsDir`** を ProjectScanner が検出して、`ProjectSummary.allureResultsDir` に保存する。後続 T203-2 (archive/copy helpers) → T203-3 (RunManager 統合) が必要とする情報基盤。

T200 (PR #34) の調査で確定:
- `ALLURE_RESULTS_DIR` env var は使えない → detect/archive/copy パターンが唯一の手段
- `allure-playwright` の `resultsDir` option は `playwright.config` 内 reporter 設定で指定する

T203-1 はこの検出側だけを実装し、archive/copy ロジック自体は T203-2 で別 PR にする (PROGRESS.md の「T203 multi-PR 推奨」に従う)。

## スコープ

### 対象

- `apps/agent/src/project/scanner.ts` — `detectAllureResultsDir(configPath)` 関数を追加し、scanProject 結果に組み込む
- `packages/shared/src/index.ts` — `ProjectSummarySchema` に `allureResultsDir: z.string().optional()` を追加
- `apps/agent/src/project/scanner.ts` — `detectAllure()` で Allure 3 CLI (`allure` package) も検出 (T200 で確定: Allure 3 CLI は `allure-commandline` ではなく `allure`)。後方互換のため `allure-commandline` (Allure 2) もカウントする
- `apps/agent/test/scanner.test.ts` — 検出シナリオ追加
- web 側のテストモック更新 (`hasAllureCli` を維持しつつ `allureResultsDir` 任意対応)

### 非対象

- archive/copy ロジック (T203-2)
- RunManager の lifecycle hook (T203-3)
- shared schema の `ArtifactKind: "allure-results"` 追加 (T203-4)
- 動的 config (env-var 参照、計算済み path 等) の対応 — ヒューリスティック検出失敗時はユーザー override に頼る (T200 メモ §1 参照)

## アプローチ

### ヒューリスティック検出パターン

`playwright.config.{ts,js,mjs,cjs}` を text として読み、以下の正規表現で `resultsDir` を抽出する:

```regex
/['"]allure-playwright['"][\s\S]*?resultsDir\s*:\s*['"]([^'"\\]+)['"]/
```

- 引用符は single / double 両対応
- `\\` を含む path は **拒否** (escape sequence は異常 / 別 OS 想定)
- `[\s\S]*?` で reporter array の改行を跨ぐが lazy match で次の `}` まで暴走しない

**マッチング対象例**:
```ts
reporter: [
  ["list"],
  ["allure-playwright", { resultsDir: "allure-results" }]
]
```
→ 抽出: `"allure-results"`

```ts
reporter: [
  "allure-playwright"  // options なし
]
```
→ 抽出: なし → `undefined` (Allure default の `allure-results` を Workbench convention として使うかは T203-2 / T203-3 で判断)

```ts
reporter: [
  ["allure-playwright", { resultsDir: process.env.OUT ?? "default" }]
]
```
→ 抽出: なし (env-var 参照は static parse 対象外) → `undefined`、warning

### Path 検証

抽出した resultsDir は以下を validate:

1. **Empty string 不可**: 空文字なら undefined + warning
2. **Absolute path 不可**: `/Users/...` は project root 外。warning + undefined
3. **Path traversal 不可**: `..` を含むなら warning + undefined
4. **Null byte 不可**: `\0` 含むなら warning + undefined
5. **Windows path-like 不可**: `C:\` 形式は project root 外想定外

これら validation は detect 関数内で完結し、warning を `ProjectSummary.warnings[]` に追加。`allureResultsDir` フィールドは検証通過時のみ set する。

### `detectAllure` の Allure 3 対応

T200 で確認: Allure 3 CLI の npm package 名は `allure` (`allure-commandline` は Allure 2)。現状の `detectAllure` は `allure-commandline` のみカウント:

```ts
// 既存
hasAllureCli: typeof deps["allure-commandline"] === "string"
```

を:

```ts
// 改修後
hasAllureCli:
  typeof deps["allure"] === "string" ||
  typeof deps["allure-commandline"] === "string"
```

に拡張。`hasAllureCli=true` は Allure CLI のいずれか (Allure 2 or 3) が install 済みであることを示す。後段の T204 (CLI subprocess 実行) で実際の CLI version check を行うので、scanner 段階では「いずれかある」シグナルで十分。

### テスト

`apps/agent/test/scanner.test.ts` に以下シナリオを追加:

1. T201 fixture style (`["allure-playwright", { resultsDir: "allure-results" }]`) — `allureResultsDir` set
2. Single-quote 引用 (`['allure-playwright', { resultsDir: 'foo/bar' }]`) — `allureResultsDir` set
3. options なし (`"allure-playwright"`) — `allureResultsDir` undefined、warning なし
4. dynamic value (`process.env.X`) — undefined + warning「resultsDir is dynamic; ProjectScanner could not detect it」
5. absolute path (`"/tmp/results"`) — undefined + warning
6. `..` traversal (`"../escape"`) — undefined + warning
7. Allure 3 CLI 単独 (devDependencies に `allure: "~3.6.2"` のみ) — `hasAllureCli: true`
8. Allure 2 CLI 単独 (devDependencies に `allure-commandline: "^2.x"` のみ) — `hasAllureCli: true` (後方互換)
9. 両方なし — `hasAllureCli: false`

### Web side test mock 更新

`apps/web/test/...` の ProjectSummary mock 9 箇所に `allureResultsDir: undefined` を default で追加 (zod schema が optional にしたので明示しなくても valid だが、test 意図を明確化するため明示)。

## 検討した代替案

- **A. ts-morph で正確に AST parse** — PLAN.v2 §24 で「Phase 5 以降 ts-morph」を約束。Phase 1.2 では heuristic で十分
- **B. 動的 config を実行して resultsDir を取得** — `import("./playwright.config")` で実評価できるが、user code の任意実行は security boundary 違反 (PLAN.v2 §28)。**非採用**
- **C. user に Workbench config 経由で明示指定させる** — Phase 1.2 後段 (T203-3 / T204) で fallback として導入。本タスクは heuristic のみ
- **D. `hasAllureCli` を分割 (`hasAllure3Cli` / `hasAllure2Cli`)** — UI 側で意味があるかは Phase 5 以降。本タスクでは boolean 維持

## 影響範囲

- `apps/agent/src/project/scanner.ts` (新関数 + 既存修正)
- `packages/shared/src/index.ts` (`ProjectSummarySchema` 拡張)
- `apps/agent/test/scanner.test.ts` (シナリオ追加)
- `apps/web/test/**/*.test.{ts,tsx}` (mock の ProjectSummary 更新 — 9 箇所程度)

既存機能への影響: ない (新 field は optional、既存 boolean field は意味維持)

## テスト方針

scanner.test.ts に 9 シナリオ追加。すべて synthetic playwright.config を一時 dir に書いて scanProject を実行し、`summary.allureResultsDir` と `summary.warnings` を検証。Allure CLI 検出は package.json mock で検証。

## リスクと緩和策

- **リスク**: 正規表現の greedy / lazy 制御ミスで false positive (例: 別 reporter の resultsDir を Allure のものと誤検出)
  - **緩和**: regex の頭で `['"]allure-playwright['"]` を anchor、その後 `[\s\S]*?` で lazy match。テストで正常 / 異常パターンを十分 cover
- **リスク**: 抽出した path が実在しない (typo) でも detect 段階では検証できない
  - **緩和**: 実在チェックは T203-2 (archive 開始時) で行う。scanner 段階では「config に書かれていた」だけを保証
- **リスク**: 動的 config を「誤って matchしないこと」を保証できない
  - **緩和**: 「matchしたら static literal とみなす」前提で進む。動的 config を static literal に偽装するのは現実的でない (動的式が含まれていれば regex は絶対 path / `..` を validate で弾く)

## 失敗カウンタ

- phase_4_5_failure_count: 0
- pr_merge_failure_count: 0
