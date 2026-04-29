# T203-3: RunManager に Allure detect/archive/copy lifecycle hook を統合

## 目的

T203-1 (resultsDir 検出 / PR #37)、T203-2 (archive/copy helpers / PR #39)、T203-4 (`allure-results` ArtifactKind / PR #38) で揃えた素材を、`runManager.startRun()` のライフサイクル内で結線する。これで Phase 1.2 detect/archive/copy パイプライン (PLAN.v2 §22) が実装的に動作する。

## スコープ

### 対象

- `apps/agent/src/playwright/runManager.ts`:
  - `RunStartParams` に `allureResultsDir?: string` を追加
  - **archive step**: `ensureDirs` 後 + `writeMetadata` 前に `archiveAllureResultsDir` を呼ぶ
  - **copy step**: `handle.result` 完了後 + `redactPlaywrightResultsSafely` の流れ内で `copyAllureResultsDir` を呼ぶ
  - 各 step の warnings は `runMetadata.warnings` に集約
  - 各 step の error は structured logger で `artifactKind: "allure-results"` + `op: "redaction"` (archive: ユーザー成果物の preserve) / 無 op (copy: 単純な artifact 移動) で記録
- `apps/agent/src/routes/runs.ts`:
  - `runManager.startRun({...})` 呼び出しに `allureResultsDir: current.summary.allureResultsDir` を追加

### 非対象

- AllureReportProvider と RunManager の wire (T202 で既に provider が `<runDir>/allure-results/` を読む契約。T203-2 で copy 先が同じ path に揃う。本 task は archive/copy だけを動かし、provider 側の wire 検討は別 task)
- HTML report 生成 (T204)
- Quality Gate (T205)

## アプローチ

### `RunStartParams` 拡張

```ts
export interface RunStartParams {
  projectId: string;
  projectRoot: string;
  packageManager: DetectedPackageManager;
  request: RunRequest;
  /**
   * Phase 1.2 (T203-3): the project-relative `resultsDir` extracted from
   * playwright.config by ProjectScanner (T203-1). When defined, RunManager
   * archives existing entries before the run and copies post-run output
   * into `<runDir>/allure-results/`. When undefined (no allure-playwright
   * reporter, dynamic config, validation rejected), the lifecycle is a
   * no-op.
   */
  allureResultsDir?: string;
}
```

### archive step

`ensureDirs(...)` の直後で実行:

```ts
artifactsStore.ensureDirs(...);

const allureWarnings: string[] = [];
if (params.allureResultsDir) {
  const sourceAbs = path.resolve(params.projectRoot, params.allureResultsDir);
  try {
    const archiveOutcome = await artifactsStore.archiveAllureResultsDir(
      params.projectRoot,
      sourceAbs
    );
    allureWarnings.push(...archiveOutcome.warnings);
  } catch (error) {
    logger?.error(
      {
        runId: "(pre-run)",
        artifactKind: "allure-results" satisfies ArtifactKind,
        op: "redaction" satisfies ArtifactOperation,
        ...errorLogFields(error)
      },
      "allure-results archive failed"
    );
    // Archive failure is fatal for the run (we cannot guarantee user data
    // preservation). Throw so the route returns 500 with a stable code.
    throw error;
  }
}
```

archive failure を **run 開始拒否** (throw) にする理由: ユーザー成果物の保護が PLAN.v2 §22 の核。archive できないまま走らせると上書きで失う。

### copy step

`handle.result` 完了後、`redactPlaywrightResultsSafely` の流れ内で呼ぶ:

```ts
const result = await handle.result;
const logWriteWarnings = await logWriter.flush();
await logStreams.closeAll();

const redactionWarning = await redactPlaywrightResultsSafely({...});

let copyWarnings: string[] = [];
if (params.allureResultsDir) {
  const sourceAbs = path.resolve(params.projectRoot, params.allureResultsDir);
  try {
    const copyOutcome = await artifactsStore.copyAllureResultsDir(
      sourceAbs,
      paths.allureResultsDest
    );
    copyWarnings = copyOutcome.warnings;
  } catch (error) {
    logger?.error(
      {
        runId,
        artifactKind: "allure-results" satisfies ArtifactKind,
        ...errorLogFields(error)
      },
      "allure-results copy failed"
    );
    copyWarnings.push(
      `Allure-results copy failed; run-scoped artifact may be incomplete. code=${errorCode(error)}`
    );
  }
}

const warnings = [
  ...allureWarnings,         // archive (pre-run)
  ...runningMetadata.warnings,
  ...logWriteWarnings,
  ...copyWarnings,           // copy (post-run)
  ...streamRedactor.flush(),
  ...flushStreamPublishWarnings(),
  ...(summary?.warnings ?? [])
];
```

copy failure を fatal にしない理由: post-run なので user data 保護への影響なし。warning として運用者に通知するだけで十分。

### Why `op: "redaction"` for archive but no op for copy?

- archive: 既存 user data を **保護目的で move** するので、redaction (= 「sensitive data の隔離」) operation 系統で表現するのが自然
- copy: 単純な artifact identity の lifecycle (run scoped 領域への materialization)。op は付けない

### routes/runs.ts wiring

```ts
const handle = await runManager.startRun({
  projectId: current.summary.id,
  projectRoot: current.summary.rootPath,
  packageManager: current.packageManager,
  request: parsed.data,
  allureResultsDir: current.summary.allureResultsDir
});
```

`current.summary.allureResultsDir` が undefined の場合は startRun の lifecycle が no-op で継続。

## 検討した代替案

- **A. archive failure を warning にする** — ユーザー成果物上書きリスクを許容することになり PLAN.v2 §22 違反。**非採用**
- **B. archive を post-run に置く** — 「次回 run の前に archive」と意味的に同じ。だが post-run と次回 startRun の間にユーザーが手動で resultsDir を消す可能性があり、archive 機会を失う。**非採用**: pre-run archive が安全
- **C. copy 失敗を fatal にする** — Playwright run は完了しているので失敗にすべきではない。warning + run.completed が正しい。**非採用**

## 影響範囲

- `apps/agent/src/playwright/runManager.ts` (RunStartParams + lifecycle hooks + import 追加)
- `apps/agent/src/routes/runs.ts` (1 引数追加)
- `apps/agent/test/runManager.test.ts` (シナリオ追加)
- `apps/agent/test/server.test.ts` (route の startRun 引数のテスト)

## テスト方針

`apps/agent/test/runManager.test.ts` で:

1. `allureResultsDir` 未指定 → lifecycle 無動作。既存 metadata.warnings に変化なし
2. `allureResultsDir` 指定 + source 不在 → archive/copy ともに no-op、warnings 空
3. `allureResultsDir` 指定 + source に既存 file → archive される (tested via filesystem)
4. archive 失敗 (FATAL_OPERATIONAL_CODE 模擬) → run 開始 throw
5. copy 失敗 (FATAL_OPERATIONAL_CODE 模擬) → run.completed + warning に code 記録
6. archive warnings + copy warnings が両方 metadata.warnings に伝搬
7. structured log: archive 失敗時 `artifactKind: "allure-results"`, `op: "redaction"`
8. structured log: copy 失敗時 `artifactKind: "allure-results"`, no op

## リスクと緩和策

- **リスク**: route が `summary.allureResultsDir` を渡し忘れる
  - **緩和**: routes/runs.ts の修正をテストで verify
- **リスク**: archive で user data を破壊する race
  - **緩和**: archive は rename + symlink-skip なので破壊性なし。FATAL でも source は触らない
- **リスク**: structured log の path 漏洩
  - **緩和**: `errorLogFields` fail-closed default で `error.message` drop。helper 内 warnings は basename-only

## 失敗カウンタ

- phase_4_5_failure_count: 0
- pr_merge_failure_count: 0
