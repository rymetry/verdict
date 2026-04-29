# T203-2: RunArtifactsStore に Allure archive/copy helper を追加

## 目的

PLAN.v2 §22 detect/archive/copy パターンの **archive** と **copy** ステップを `RunArtifactsStore` 抽象に追加する。T203-1 (PR #37) で `summary.allureResultsDir` の検出を完了済み。本タスクは I/O 側の素材 (helper メソッド + paths) を整備し、T203-3 (RunManager 統合) で組み立てる準備をする。

PLAN.v2 §22 で確定した lifecycle:

```
[Test 実行前]
  1. resultsDir 内の既存ファイルを `.playwright-workbench/archive/<timestamp>/` へ移動 (archive)
  2. resultsDir が空 or 存在しない状態でテスト実行

[Test 実行後]
  3. resultsDir の内容を `.playwright-workbench/runs/<runId>/allure-results/` にコピー (copy/detect)
```

archive と copy は I/O 操作として独立しており、別々に unit test できる粒度。runManager 内に直接書くと SRP 違反 + テスト困難になるため store 側に置く。

## スコープ

### 対象

- `apps/agent/src/storage/paths.ts`:
  - `WorkbenchPaths.archiveDir` を追加 (`.playwright-workbench/archive/`)
  - `RunPaths.allureResultsDest` を追加 (`.playwright-workbench/runs/<runId>/allure-results/`)
- `packages/shared/src/index.ts`:
  - `RunPathsSchema` に `allureResultsDest: z.string()` を追加 (existing `playwrightHtml` パターンに従う)
- `apps/agent/src/playwright/runArtifactsStore.ts`:
  - `archiveAllureResultsDir(projectRoot, sourceAbs)` — 既存 sourceAbs の内容を `archiveDir/<timestamp>/` へ move
  - `copyAllureResultsDir(sourceAbs, destAbs)` — sourceAbs から destAbs へ recursive copy
  - 両方とも `RunArtifactsStore` interface に追加
- `apps/agent/test/runArtifactsStore.test.ts`:
  - archive / copy の動作シナリオ (空 / 単一 / 多階層 / 不在 / symlink / 競合) を追加

### 非対象

- runManager から両 helper を呼ぶ統合 (T203-3)
- T203-1 で検出済み `summary.allureResultsDir` を runManager に流す配線 (T203-3)
- `archive` 失敗時の terminal event 設計 (T203-3 で warning として surfacing)
- `<runId>/allure-results/` を読む `AllureReportProvider` 連携 (T203-3 で wire)

## アプローチ

### `archiveAllureResultsDir` の挙動

```ts
async archiveAllureResultsDir(
  projectRoot: string,
  sourceAbs: string
): Promise<{ archived: boolean; archivePath?: string; warnings: string[] }>
```

入力:
- `projectRoot`: realpath。archive dest 親 (`workbenchPaths(projectRoot).archiveDir`) を導出
- `sourceAbs`: T203-1 で検出 + validate 済み `allureResultsDir` を `path.resolve(projectRoot, allureResultsDir)` した結果

挙動:

1. `sourceAbs` 存在チェック
   - **不在** (ENOENT): `{ archived: false, warnings: [] }`。allure-playwright が前回未実行 / 削除済み — 通常状態
   - **regular file** (not directory): `{ archived: false, warnings: ["sourceAbs is not a directory"] }`。設定ミスシグナル
   - **symlink**: `lstat` で type 判定。directory への symlink は受け入れず archive (PLAN.v2 §28 path-redaction policy: symlink follow を避ける)。symlink には warning + skip
2. `readdir(sourceAbs)` 実行
   - **空ディレクトリ**: `{ archived: false, warnings: [] }`。何もする必要なし
3. archive dest 作成
   - timestamp prefix: `new Date().toISOString().replace(/[:.]/g, "-")` → ファイル名安全化
   - 親 dir 作成: `mkdir -p archiveDir`
   - 子 dir: `mkdir archiveDir/<timestamp>/`
4. 全 entries を rename で move
   - 各エントリを `path.join(sourceAbs, name)` から `path.join(archiveDirChild, name)` へ rename
   - rename 失敗 (e.g. EXDEV cross-device): copy + delete fallback。warning で記録
   - 一部失敗時: 部分 archive 警告 + 続行
5. `{ archived: true, archivePath: archiveDirChild, warnings: [...] }` を返す

### `copyAllureResultsDir` の挙動

```ts
async copyAllureResultsDir(
  sourceAbs: string,
  destAbs: string
): Promise<{ copied: boolean; fileCount: number; warnings: string[] }>
```

入力:
- `sourceAbs`: project-relative resultsDir を resolve した絶対 path
- `destAbs`: `runPathsFor(projectRoot, runId).allureResultsDest`

挙動:

1. `sourceAbs` 存在 + readdir
   - 不在 (ENOENT): `{ copied: false, fileCount: 0, warnings: [] }` (allure-playwright が結果を吐かなかった、testが 0 件など)
   - 空ディレクトリ: `{ copied: false, fileCount: 0, warnings: [] }`
2. `mkdir -p destAbs` で dest 作成
3. recursive walk で全 regular file を copy
   - symlink follow しない (PLAN.v2 §28)。symlink は warning + skip
   - **node:fs/promises.cp(src, dest, { recursive: true, force: true, errorOnExist: false, dereference: false })** が Node 18+ で利用可能。これを採用する場合、symlink filter / file count はファイル後段の readdir で実施
   - alternative: 自前 walker (もっと制御しやすい)。本タスクでは **自前 walker** を選択 (warning 集約 + filter logic を細かく制御するため)
4. fileCount を集計
5. `{ copied: true, fileCount, warnings }` を返す

### Path additions

```ts
// storage/paths.ts
export interface WorkbenchPaths {
  root: string;
  workbenchDir: string;
  configDir: string;
  reportsDir: string;
  runsDir: string;
  archiveDir: string; // ← 新規
}

export function workbenchPaths(projectRoot: string): WorkbenchPaths {
  // ...
  return {
    // ...
    archiveDir: path.join(workbenchDir, "archive"),
  };
}

export function runPathsFor(projectRoot: string, runId: string): RunPaths {
  // ...
  return {
    // ...
    allureResultsDest: path.join(runDir, "allure-results"), // ← 新規
  };
}
```

shared/index.ts の `RunPathsSchema` も `allureResultsDest: z.string()` を required field として追加。**optional ではない** (RunPaths はすべての run で生成される論理 path 集合。Allure 不使用でも path 自体は導出可能)。

### Symlink policy

PLAN.v2 §28 / Issue #27 の path-redaction policy に従い、symlink **follow を避ける**:

- archive: source 内 entries に symlink があれば skip + warning ("symlink not archived")
- copy: source 内 entries に symlink があれば skip + warning ("symlink not copied")
- archive dest / copy dest が symlink 経由でないことを `lstat` で確認
- これにより悪意ある config が `resultsDir: "./escape"` で project root 外を archive/copy 対象にする経路を塞ぐ

### Path leakage policy

新 logger 呼び出しは追加しない (T203-2 は I/O helper のみ。logger 呼び出しは T203-3 の RunManager で行う)。warning は string の配列として返し、caller (T203-3) が `errorLogFields` + `artifactKind: "allure-results"` で structured log を出す責務。

helper 内の warning 文は **絶対 path を含めない**。検出 / 計上された file count / 失敗 code を含める形:
- ❌ `"could not move /Users/.../allure-results/x.json"`
- ✅ `"could not move 1 of 5 entries during archive. code=EBUSY"`

## 検討した代替案

- **A. `node:fs/promises.cp` を使う** — Node 18+ で recursive copy 標準化。**部分採用**: cp は便利だが symlink/non-regular file の filtering を自前で書きたいので、archive 用 rename loop は自前、copy 用は cp 経由。が、warning 集約難しいため最終的に自前 walker
- **B. archive を skip する (overwrite-only)** — 「ユーザー成果物を保護」が PLAN.v2 §22 の核。**非採用**
- **C. symlink follow** — convenience だが §28 違反。**非採用**
- **D. archive subdir に runId を使う** — archive は run より前に行うため runId 未確定。timestamp が正しい

## 影響範囲

- `apps/agent/src/storage/paths.ts` (2 paths 追加)
- `packages/shared/src/index.ts` (RunPathsSchema 1 field 追加)
- `apps/agent/src/playwright/runArtifactsStore.ts` (interface 2 methods 追加 + 実装)
- `apps/agent/test/runArtifactsStore.test.ts` (シナリオ追加)
- 既存 `runManager.ts` 影響なし (T203-3 で wire)
- web 側影響なし (RunPaths は agent 内部 model)

## テスト方針

`apps/agent/test/runArtifactsStore.test.ts` で以下シナリオ:

**archiveAllureResultsDir:**
1. source 不在 (ENOENT): `archived: false`, no warning
2. source は regular file: `archived: false`, warning
3. source は空 directory: `archived: false`, no warning
4. source に 1 file: `archived: true`, archivePath 設定、source 空、destination に file あり
5. source に 1 file + 1 subdir (中に file): recursive 移動
6. source に symlink: skip + warning, 他のエントリは move
7. archive dest がまだない: 親 directory + timestamped subdir 作成
8. timestamp 衝突 (同一 ms 内 2 回 archive): suffix 付与

**copyAllureResultsDir:**
1. source 不在: `copied: false`, fileCount: 0
2. source 空: `copied: false`, fileCount: 0
3. source に 1 file: dest に file あり、source も残る (copy なので破壊しない)
4. source に nested directory: recursive copy
5. source に symlink: skip + warning
6. dest 既存 (上書き想定): copy 続行 (force semantics)
7. dest 親 dir 不在: 自動 mkdir

## リスクと緩和策

- **リスク**: archive で rename 失敗 (cross-device EXDEV) で部分移動状態
  - **緩和**: rename 失敗時 copy+unlink fallback。失敗集約 warning で transparent に
- **リスク**: copy 中に source が変わる (Playwright がまだ書いている)
  - **緩和**: copy は post-run なので Playwright プロセスは既に終了済み (T203-3 で乗せる順序)。本 helper レベルでは race を回避できないが、caller の責務を JSDoc で明記
- **リスク**: symlink 経由で project root 外を archive 対象にされる
  - **緩和**: `lstat` で type 判定 + symlink skip
- **リスク**: archive dir 自体が肥大化
  - **緩和**: PoC では retention policy なし (PLAN.v2 §33 で「Phase 2 以降」と記載)。本 helper は「archive する」までを保証

## 想定外の判断ポイント

- archive timestamp format: ISO8601 を `.` `:` 置換して `2026-04-29T01-30-45-123Z` 形式。Windows でも valid だが見た目が冗長 → 採用 (parseable)
- copy で hidden files (`.allurerc.mjs` など) を copy する? — 現状の allure-playwright 出力は dot-prefix file 不使用。copy 時 hidden filter なし (全 entries copy)
- archive dest が既存 dir だった場合 (timestamp 衝突のレアケース): suffix `-2`, `-3`, ... を試す

## 失敗カウンタ

- phase_4_5_failure_count: 0
- pr_merge_failure_count: 0
