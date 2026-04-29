# T204-3: Allure HTML report 生成 (CLI subprocess + RunManager hook)

## 目的

T204-1 (paths + identity / PR #41) と T204-2 (args validator + policy / PR #42) で揃えた素材を、実際の `allure generate` subprocess 実行に結線する。Phase 1.2 の HTML report が `runs/<runId>/allure-report/` に生成され、UI / API が file:// link で公開できる状態にする。

## スコープ

### 対象

- 新規: `apps/agent/src/playwright/allureReportGenerator.ts`
  - `generateAllureReport(...)` — subprocess を spawn し outcome を返す
  - `AllureGenerateOutcome` interface
- `apps/agent/src/playwright/runManager.ts`:
  - `RunManagerDeps.allureRunnerForProject?` を追加
  - copy step 後に `generateAllureReport` を呼ぶ lifecycle hook (`runReportGenerationStep`)
- `apps/agent/src/server.ts`:
  - `allureRunnerForProject` を `createNodeCommandRunner({ policy: createAllureCommandPolicy(...), audit })` で wire
  - `BuildAppResult` に `allureRunnerForProject` を expose (test injection 用)
- `apps/agent/test/runManager.test.ts`: lifecycle hook テスト
- `apps/agent/test/allureReportGenerator.test.ts`: 新規ユニットテスト

### 非対象

- Allure CLI の **実機実行** (T204 verification step / 別 task)
- Quality Gate (T205)
- history 永続化 (T206)
- QMO summary (T207)
- GUI 表示 (T208)

## アプローチ

### subprocess 仕様

```
exec: <projectRoot>/node_modules/.bin/allure
args: [
  "generate",
  ".playwright-workbench/runs/<runId>/allure-results",  // results-dir (project-relative)
  "-o",
  ".playwright-workbench/runs/<runId>/allure-report",   // report-dir (project-relative)
  "--clean"
]
cwd: projectRoot
timeout: 60s (HTML 生成は数秒で済むはず。多くの test 結果で長くなっても 1 分以内)
```

`runPathsFor` の値は **絶対 path** で返るので、`generateAllureReport` 内で `path.relative(projectRoot, ...)` で project-relative path に変換してから validator に渡す。

### `generateAllureReport(...)` 関数

```ts
export interface AllureGenerateOutcome {
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  reportPath?: string;  // ok=true の時のみ set
  warnings: string[];   // 失敗時の path-redacted summary (caller logs structured)
}

export async function generateAllureReport(input: {
  runner: CommandRunner;
  projectRoot: string;
  runId: string;
  allureResultsDest: string;
  allureReportDir: string;
  timeoutMs?: number;
}): Promise<AllureGenerateOutcome>
```

挙動:
1. allure binary の存在チェック (`<projectRoot>/node_modules/.bin/allure`)
   - 不在 → `{ ok: false, warnings: ["Allure CLI not found in node_modules"] }`、subprocess 起動なし
2. results-dir, report-dir を `path.relative(projectRoot, abs)` で project-relative 化
3. CommandRunner 経由で spawn (audit log + policy enforcement 自動)
4. timeout / cancel handling は CommandRunner 任せ
5. exit code 0 → `{ ok: true, reportPath: allureReportDir, ... }`
6. exit code != 0 → `{ ok: false, warnings: ["allure generate exited with code N"] }`
7. spawn / policy error → `{ ok: false, warnings: [`allure generate failed: code=...`] }`

### RunManager 統合

```ts
// runManager.ts copy step の後
const reportGenerationWarnings = await runReportGenerationStep({
  projectRoot: params.projectRoot,
  allureResultsDir: params.allureResultsDir,
  allureResultsDest: paths.allureResultsDest,
  allureReportDir: paths.allureReportDir,
  runId,
  allureRunner: allureRunnerForProject?.(params.projectRoot),
  logger
});

const warnings = [...allureWarnings, ...logWriteWarnings, ...copyWarnings, ...reportGenerationWarnings, ...];
```

`allureRunnerForProject` が undefined (test 環境など) → no-op。
copy step が succeed しなかった場合 (warnings あり) は generate を skip すべきか? 設計判断:
- copy.copied === false → results-dir 空 → generate しても意味なし → skip
- copy.copied === true (warnings あり) → generate 試行 (Allure CLI が部分結果で何か作るかは Allure 側の判断)

簡略化: `generateAllureReport` は results-dest が空でも実行する (Allure CLI が判断)。warning はそのまま伝搬。

### server.ts wire

```ts
const allureRunnerForProject = (projectRoot: string): CommandRunner =>
  createNodeCommandRunner({
    policy: createAllureCommandPolicy(projectRoot),
    audit: (entry) => {
      // 既存 audit 経路と同じく cwdHash + persistence + logger.info
      // (重複避けるため共通 helper 化を別 task で検討)
    }
  });
const runManager = createRunManager({
  runnerForProject,
  allureRunnerForProject,
  bus, logger
});
```

audit logging の重複コードは別 task で refactor。本 PR では copy-paste で済ませる。

### structured logger 仕様

- 成功時 (info): `{ runId, artifactKind: "allure-report", durationMs, exitCode: 0 }`
- 失敗時 (error): `{ runId, artifactKind: "allure-report", code: "<exit-code-or-error-code>", ...errorLogFields(error) }`
- skip 時 (info): `{ runId, artifactKind: "allure-report", reason: "no-results" }` または warning のみ

## 検討した代替案

- **A. RunArtifactsStore に generateAllureReport を追加** — Store は file ops に集中 (SRP)。subprocess は別 abstraction が clean。**非採用**: 採用 (SRP 違反回避)
- **B. Programmatic API (@allurereport/core)** — preact dep + UI lib として scope outside agent。T200 で除外済み。**非採用**
- **C. allure CLI 起動を deferred (T208 で UI request 時に on-demand 実行)** — リアルタイム性低下 + 利用者からは遅く見える。**非採用**: post-run で eager に generate する方が UX clean
- **D. allure-playwright reporter の `generateReport: true` option を使う** — option が存在するか不明 + Workbench の archive/copy lifecycle と衝突。**非採用**

## 影響範囲

- `apps/agent/src/playwright/allureReportGenerator.ts` (新規)
- `apps/agent/src/playwright/runManager.ts` (RunManagerDeps 拡張 + lifecycle hook 追加)
- `apps/agent/src/server.ts` (allureRunnerForProject wire + BuildAppResult expose)
- `apps/agent/test/runManager.test.ts` (lifecycle hook テスト)
- `apps/agent/test/allureReportGenerator.test.ts` (新規ユニット)
- 既存 server.test.ts は `BuildAppResult` を分解する箇所で破綻しないか確認

## テスト方針

`apps/agent/test/allureReportGenerator.test.ts`:
1. allure binary 不在 → `ok: false`, warning含む, subprocess 不実行
2. exit 0 → `ok: true`, reportPath set
3. exit non-zero → `ok: false`, warning + stdout/stderr captured
4. project-relative path 変換が正しい
5. policy 違反 (絶対 path) は CommandRunner が reject (in-process test で simulate)

`apps/agent/test/runManager.test.ts`:
1. allureRunnerForProject 未設定 → lifecycle hook が呼ばれない、warnings なし
2. allureRunnerForProject 設定 + allureResultsDir 未設定 → hook skip
3. 両方設定 + allure CLI 実行成功 → metadata.warnings に "Allure HTML report generated" info、reportPath 構造ログ
4. allure CLI 失敗 → warning に code 記録、structured log error

## リスクと緩和策

- **リスク**: allure CLI が長時間かかる
  - **緩和**: 60s timeout
- **リスク**: spawn error (allow-list 問題)
  - **緩和**: T204-1 で `allure` 追加済み + T204-2 args validator
- **リスク**: 既存 server.ts BuildAppResult 分解で test 破綻
  - **緩和**: typecheck + 既存 test 全 green を維持

## 失敗カウンタ

- phase_4_5_failure_count: 0
- pr_merge_failure_count: 0
