# Implementation Report — PLAN.v2 Progress

## Phase 1.5 Bun Feasibility Spike (2026-05-01)

### 実装サマリ

- **完了タスク数**: 1 (T400)
- **目的**: PLAN.v2 §30 の Bun feasibility spike を完了し、Bun を標準実行対象に昇格する条件を明確化する。

### T400: Bun feasibility spike report

- **変更ファイル**: `docs/design/T400.md`, `docs/operations/bun-feasibility-report.md`, `IMPLEMENTATION_REPORT.md`
- **主要設計判断**: Bun 検出時の `experimental-bun` block は維持する。`bunx --no-install` は auto-install 抑止には有効だが、現行 pnpm workspace fixture では `playwright` / `allure` local binary を解決できなかったため、BunCommandRunner の production 実装は専用 Bun fixture と CI 検証が揃うまで延期する。
- **特記事項**: bare `bunx` は公式 docs 上 npm auto-install fallback があるため、Workbench の暗黙 install 禁止方針に従って実行していない。

### 実行したテスト

- `bun --version`
- `bunx --no-install --bun playwright --version`
- `bunx --no-install playwright --version`
- `bunx --no-install --bun allure --version`
- `pnpm typecheck`
- `pnpm test` (agent 411 / web 387)
- `pnpm build`

`pnpm typecheck` / `pnpm test` は初回 `node_modules` 不在で失敗したため、`pnpm install --frozen-lockfile` を実行して再検証した。sandbox DNS 制限により install は一度失敗し、許可付きで再実行して成功。

### セキュリティ確認事項

- Bare `bunx` による network / global cache 副作用を避けた。
- production command policy は変更していない。
- Bun 対応の graduation conditions に local binary only、argv validator、cwd boundary、audit log 継承を明記した。

---

## Phase 2 Failure Review Workbench Update (2026-05-01)

### 実装サマリ

- **完了タスク数**: 1 (T300)
- **マージ済 PR**: #60
- **最終マージ commit**: `24f17628dfa24da41474fdd82e5aff323a887c2d`
- **目的**: PLAN.v2 §31/§32 の Phase 2 成功条件「失敗testごとにstack、artifact、Allure履歴、known issue/flakyが確認できる」を満たす。

### T300: Phase 2 Failure Review Workbench

- **変更ファイル**: `packages/shared/src/index.ts`, `apps/agent/src/reporting/failureReview.ts`, `apps/agent/src/routes/runs.ts`, `apps/web/src/api/client.ts`, `apps/web/src/features/failure-review/FailureReview.tsx`, related tests, `docs/design/t300-phase-2-failure-review-workbench.md`
- **主要設計判断**: 既存 `/runs/:runId` の永続 metadata は変更せず、新設 `GET /runs/:runId/failure-review` で run summary に Allure results / Allure history JSONL / known-issues JSON を best-effort 合成する。Allure 固有の照合ロジックは agent 側に閉じ込め、web は shared zod schema の Workbench shape だけを扱う。
- **特記事項**: Allure side files が欠落または malformed の場合も basic failure detail は表示し続け、warning として surface する。

### 実行したテスト

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm smoke:gui`
- GitHub Actions CI #146: `verify (node 24)` success, `gui smoke (node 24)` success

### セキュリティ確認事項

- 新 API は Workbench 管理下の run metadata / run-scoped Allure results / project-scoped reports の read のみ。
- 任意コマンド実行、外部送信、設定変更、artifact 削除は追加していない。
- warning は stable code / context を中心にし、新たな path 露出 surface を増やさない。

### パフォーマンス・運用上の影響

- `known-issues.json` は 1 MiB cap を設け、過大 file は読み飛ばして warning 化する。
- Allure history は既存 reader の cap / validation を再利用する。
- FailureReview UI は既存 row 表示に per-test signal panel を足すだけで、既存 run console / inventory flow には影響しない。

### ミッション完了条件のセルフチェック

- [x] T300 が PROGRESS.md 上で完了
- [x] T300 の Definition of Done を満たす
- [x] PR #60 がマージ済み
- [x] 最終統合確認に合格
- [x] 本レポートを更新済み

---

# Implementation Report — Phase 1.2 Allure Report 3 Integration

**Engagement scope**: Phase 1.7 cleanup (open Issues #27 / #30 / #31) + PLAN.v2 §22-§28 Phase 1.2 (Allure Report 3 統合 PoC) end-to-end.

**Period**: 2026-04-29 〜 2026-04-30 (autonomous loop session).

## 実装サマリ

- **完了タスク数**: 19 (T100, T101-T104, T105, T200, T201, T202, T203-{1,2,3,4}, T204-{1,2,3}, T205-{1,2}, T206, T207, T208-{1,2})
- **マージ済 PR 数**: 19 (#32 〜 #49)
- **ベースライン → 最終 テスト数**: agent **194 → 359** (+165) / web **348 → 366** (+18) / **総 725** all green
- **typecheck**: 全 workspace clean (shared / agent / web / agent:test)
- **build**: 全 workspace 成功 (shared / agent / web)
- **CI**: 全 19 PR で `verify (node 24)` + `gui smoke (node 24)` SUCCESS

## タスク別概要

### Phase 1.7 cleanup (Issue #27 / #30 / #31)

| Task | PR | 役割 |
|---|---|---|
| T100 | (issue close) | Issue #27 5 項目を pre-existing PR で実装済み確認 → close |
| T101-T104 | #32 | ArtifactKind 型レベル regression / `expectNoPathLeak` helper / `runTypes.ts` shim 削除 / `main()` pino logger 統一 |
| T105 | #33 | `ArtifactKind` を identity-only union (7 メンバー) + 別 `ArtifactOperation` union (3 メンバー) に直交化 |

### Phase 1.2 prep

| Task | PR | 役割 |
|---|---|---|
| T200 | #34 | Allure Report 3 / allure-playwright 公式 docs + Context7 調査メモ。CLI package `allure` 確定、`ALLURE_RESULTS_DIR` env var 不在確定、history JSONL 確定。実機検証で `allure agent` / `allure log` が CLI として実在することを発見し訂正セクション追記 |
| T201 | #35 | `tests/fixtures/sample-pw-allure-project/` 新設 (`@playwright/test` + `allure-playwright@~3.7.1` + `allure@~3.6.2` patch-only pin) |
| T202 | #36 | `AllureReportProvider` 抽象 + zod-based result reader。broken→failed (warning code: ALLURE_BROKEN_TEST), unknown→counter にも入れず警告 (ALLURE_UNKNOWN_STATUS), malformed timing 検知 (ALLURE_MALFORMED_TIMING), process-level FATAL_OPERATIONAL_CODES propagate |

### Phase 1.2 detect/archive/copy lifecycle (T203)

| Task | PR | 役割 |
|---|---|---|
| T203-1 | #37 | ProjectScanner に `detectAllureResultsDir(configText)` heuristic 検出 + `safeReadConfigText` (1 MiB size cap)。comment-strip + segment-based traversal validation |
| T203-2 | #39 | `RunArtifactsStore` に `archiveAllureResultsDir` / `copyAllureResultsDir` 追加。FATAL_OPERATIONAL_CODES (EMFILE/ENFILE/EACCES/EIO/ENOSPC/EDQUOT/EROFS) propagate, `walkAndCopy` で symlink 一貫 skip, EXDEV cleanup, 空 archive 自動削除 |
| T203-3 | #40 | `RunManager` lifecycle hook 統合。**archive 失敗 = run startup throw** (ユーザー成果物保護 invariant 優先)、copy 失敗 = warning + non-fatal |
| T203-4 | #38 | `ArtifactKind` に `"allure-results"` identity 追加 (just-in-time addition convention) |

### Phase 1.2 HTML report generation (T204)

| Task | PR | 役割 |
|---|---|---|
| T204-1 | #41 | Paths (`runDir/allure-report`) + `ArtifactKind: "allure-report"` + `DEFAULT_ALLOWED_EXECUTABLES` に `"allure"` 追加 |
| T204-2 | #42 | `validateAllureGenerateArgs` + `createAllureCommandPolicy` factory。defense-in-depth (Workbench-only argv), per-subcommand value/standalone flag sets, replace-not-extend duplicate detection (`-o` + `--output` synonym pair, all other value flags) |
| T204-3 | #43 | `generateAllureReport()` CLI subprocess + RunManager hook。failureMode discriminator (binary-missing / timeout / exit-nonzero / spawn-error / no-results), FATAL_OPERATIONAL_CODES propagate (`runner.ts` で spawn error の `.code` 保持)、verbatim stdout/stderr を outcome から削除 (path-redaction) |

### Phase 1.2 Quality Gate (T205)

| Task | PR | 役割 |
|---|---|---|
| T205-1 | #44 | `validateAllureArgs` に `quality-gate` subcommand 対応を追加 (内部 dispatch)。`validateAllureGenerateArgs` を backward-compat alias で温存 |
| T205-2 | #45 | `evaluateAllureQualityGate` + `persistQualityGateResult` + RunManager hook。PLAN.v2 §23 status mapping (0=passed/1=failed/other=error), persistence の FATAL propagation (review fix で追加) |

### Phase 1.2 history + QMO summary (T206 / T207)

| Task | PR | 役割 |
|---|---|---|
| T206 | #46 | `--history-path` flag を Allure args policy に追加 + `canonicalAllureFlag` synonym normalization (`-h` ↔ `--history-path`)。`workbenchPaths.allureHistoryPath` を generator に thread |
| T207 | #47 | QMO Release Readiness Summary v0 (Markdown + JSON)。pure derivation (RunMetadata + persisted QG)、outcome rules (ready/conditional/not-ready PLAN.v2 §27)、`ReadQualityGateOutcome` discriminated union (absent vs unreadable distinction で silent QG-loss 防止)、QMO step を **final writeMetadata 前**に移動 (warnings が persisted run record に反映)、`reportLinks` を warning markers でゲーティング |

### Phase 1.2 GUI display (T208)

| Task | PR | 役割 |
|---|---|---|
| T208-1 | #48 | `GET /runs/:runId/qmo-summary` (JSON) + `GET /runs/:runId/qmo-summary.md` (text/markdown) endpoints。stable error codes (`NO_QMO_SUMMARY` 409 / `INVALID_QMO_SUMMARY` 500 / `QMO_SUMMARY_READ_FAILED` 500) |
| T208-2 | #49 | `<QmoSummaryBanner />` component + `useQmoSummaryQuery` / `useLatestQmoSummary` hooks + `pickLatestRun` helper。`/qmo` route 上部に live banner、isError / isEmpty / loading / 409 NO_QMO_SUMMARY / loaded の 5 状態を branch |

## 主要な設計判断と理由

### 1. FATAL_OPERATIONAL_CODES propagation pattern

`{EMFILE, ENFILE, EACCES, EIO, ENOSPC, EDQUOT, EROFS}` セットを **runArtifactsStore / allureReportGenerator / allureQualityGate / persist 全パス** で統一。これらの code が出た時に skip-and-warn ループに入ると N 個の near-identical warning を吐きながら operator-action condition (FD 枯渇 / disk full / 権限不正) を埋もれさせる。1 throw → caller が 1 構造化 error を出すことで surface する。

### 2. Issue #31 axes (artifactKind identity-only + op? operation)

PR #33 で確立した axes 分離を Phase 1.2 全体で維持。新 identity は producer が必要になった時に追加 (`allure-results` @ T203-4, `allure-report` @ T204-1)。`playwright-html` のような dead-union-member trap を回避。

### 3. Path-redaction policy (Issue #27)

- `errorLogFields(error)` の fail-closed default で `error.message` を drop (絶対 path 流出抑止)
- helper-side warning は basename + stable code のみ
- subprocess stdout/stderr を outcome 型から削除 (T204-3 review fix)
- API response body は stable codes のみ、絶対 path を出さない

### 4. Defense-in-depth args validators

Workbench は argv を全て自分で組み立てるため、validator は paranoid に **Workbench が emit する正確な shape のみ accept**。新 subcommand を許す時は明示的に policy 拡張するルールを load-bearing にする。

### 5. Lifecycle hook の failure semantics 非対称

| Step | failure |
|---|---|
| archive (pre-run) | **FATAL** — ユーザー成果物保護優先 |
| copy (post-run) | non-fatal warning |
| generate HTML (post-run) | non-fatal warning |
| evaluate QG (post-run) | non-fatal warning |
| QMO summary persist | FATAL_OPERATIONAL_CODES のみ propagate、他は warning |

archive 以外を non-fatal にする理由: テスト実行はもう完了しており、subsequent step の failure で run 結果を invalidate しない。

### 6. Validator synonym normalization

`-o`/`--output` および `-h`/`--history-path` は `canonicalAllureFlag` で正規化。mixed-form duplicate (`-o A --output B`) を `duplicate-output-flag` で reject。

### 7. QMO summary の reportLinks gating (T207 review fix)

`RunMetadata.paths.allureReportDir` は構造的に常に derive 可能だが、generation が skip/failure した場合 file は存在しない。`ALLURE_REPORT_FAILED_MARKERS` 等を warning から検出して `reportLinks` を gate。PR comment / external consumer が 404 link を踏まないようにする。

## 実行したテスト

### Unit / Integration

- agent: 359 tests / 23 files
- web: 366 tests / 45 files
- shared schema: type-level regression assertions (`expectTypeOf` で identity / operation union を凍結)

### Carve-outs

- 各 lifecycle step が FATAL_OPERATIONAL_CODES (EACCES / EMFILE / ENFILE / ENOSPC / EDQUOT / EROFS / EIO) で propagation することを `it.each` で個別テスト
- path-redaction の `expectNoPathLeak` helper でヘルパーが basename-only 警告を保つことを assertion 化
- Markdown / JSON 永続化が parent dir auto-create することを test
- GUI banner の 5 状態 (loading / error / isEmpty / 409-empty / loaded) を個別 test

### CI

19 PR 全てで `verify (node 24)` + `gui smoke (node 24)` SUCCESS。

## セキュリティ確認事項

- **任意コマンド実行抑止**: CommandRunner policy で `allure` (新規) を含む allowedExecutables を pin、shell 不使用、args 配列のみ。`createAllureCommandPolicy` の args validator は `generate` / `quality-gate` 以外の subcommand を拒否し、各 subcommand 内も既知 flag のみ許可
- **Path traversal 抑止**: `validateProjectRelativeOperand` で absolute / `..` segment / NUL byte / Windows-drive を拒否
- **Symlink follow 抑止**: archive / copy の両方で `lstat` + `entry.isSymbolicLink()` で skip + warning。fs.cp の `dereference: false` は内部 symlink を verbatim copy するため archive EXDEV fallback では `walkAndCopy` を使い skip 一貫性を確保
- **Path leakage 抑止**: `errorLogFields(error)` fail-closed default で `error.message` (絶対 path) を drop、subprocess stdout/stderr を outcome から削除、warning は basename + stable code のみ
- **Synonym duplicate detection**: `-o`/`--output` および `-h`/`--history-path` を `canonicalAllureFlag` で正規化し mixed-form duplicate を `duplicate-flag` で reject
- **Audit log**: 全 CommandRunner spawn が audit ログに残る (cwdHash + executable + args + 実行時刻)。`buildAuditHandler(projectRoot)` factory を一本化し Playwright runner と Allure runner で同 audit 形状

## パフォーマンス・運用上の影響

- archive 操作は POSIX `rename` 使用、cross-device は cp+rm fallback。同一 device 上では O(n) entries
- copy 操作は `fs.copyFile` の serial loop。Phase 1.2 PoC では parallelization 不要 (Allure results は通常数十 file)
- subprocess timeout: generate 60s / quality-gate 30s。large suite で不足する場合は `timeoutMs` option で個別調整可
- web bundle: 542 KB minified / 169 KB gzip (Phase 1 Foundation に対する増分は数 KB の Banner component のみ)

## 既知の制約・残課題・今後の改善余地

### Phase 1.2 で deferred

- **AllureReportProvider と RunManager の wire**: T202 で provider 単体は完成したが、`runManager.ts` の `reportProvider` injection は依然 `playwrightJsonReportProvider` のみ。Allure provider の active 利用は Phase 1.2 後段で行うか、QmoSummary に直接 Allure フィールドを足すかは要判断
- **`InsightsView` 全体の live data 化**: 現状 placeholder データ (T026) と live banner (T208-2) が並走。Phase 1.2 後段で `useInsightsSummary()` フル置換を予定
- **AI Release Readiness commentary**: PLAN.v2 §27 の AI 出力 (Phase 9) は本 phase で扱わない。`QmoSummary` shape は将来 `ai?: AiSummary` field を additive に拡張可
- **Profile-driven QG rules**: `runQualityGateStep` は default profile (`local-review`) で CLI defaults。`release-smoke` / `full-regression` profile の rule sets を Workbench config から渡す機構は未実装
- **`/qmo/:runId` route**: 現状 `/qmo` は最新 run のみ。run-by-run navigation は Phase 6 (Playwright Operations GUI) で導入予定

### Phase 1.5 以降

- **Bun feasibility spike** (T1.5 / PLAN.v2 §30): 未着手
- **Phase 2-10**: PLAN.v2 §31 に従い、Failure Review Workbench (Phase 2) → AI Analysis (Phase 3) → Repair Review (Phase 4) → 残り phase で展開予定

## レビュー結果と対応サマリ

19 PR 全てで `pr-review-toolkit:review-pr` (code-reviewer / silent-failure-hunter / pr-test-analyzer / comment-analyzer / type-design-analyzer のいずれかまたは複数) を実行。

| カテゴリ | 件数 | 対応 |
|---|---|---|
| Must Fix | 4 | 全件対応 (T207 PR #47 review で 2、T204-3 PR #43 review で 2) |
| Should Fix | ~15 | 全件対応 |
| Nice to Have | 多数 | 採用判断で取り捨て、設計メモまたは PR 説明に記録 |

代表的な Must Fix:
- **T204-3 PR #43**: subprocess wrapper が FATAL_OPERATIONAL_CODES を swallow していた → `runner.ts` で spawn error の `.code` 保持 + `FATAL_OPERATIONAL_CODES` 制で propagation
- **T204-3 PR #43**: outcome 型に verbatim stdout/stderr が露出していた → 削除 (T207 で構造化情報のみ surface)
- **T207 PR #47**: `readPersistedQualityGate` が non-ENOENT 失敗を silently absent 扱いしていた → `ReadQualityGateOutcome` discriminated union で `unreadable` を分離
- **T207 PR #47**: QMO step が final writeMetadata 後に走り、warning が persisted record に反映されなかった → step を pre-final に移動

## ミッション完了条件のセルフチェック

- [x] 1. PROGRESS.md の全タスクが完了 (T100, T101-T104, T105, T200-T207, T208-1, T208-2)
- [x] 2. 各タスクが Definition of Done を満たす (要件 / 設計メモ / テスト / セキュリティ / レビュー指摘対応)
- [x] 3. 全 PR がマージ済み (PR #32 〜 #49)
- [x] 4. 最終統合確認に合格 (typecheck / 725 tests / build 全 green)
- [x] 5. 本レポートが作成済み
- [x] 6. ロックファイルは最終 commit 後に解除予定

## 次のミッション候補 (要ユーザー判断)

- **PLAN.v2 §38 Allure prompt 群の残り**: AllureReportProvider と RunManager の wire / `useInsightsSummary` フル置換
- **Phase 1.5 Bun spike**: PLAN.v2 §30 の項目を独立 PR series で
- **Phase 2 Failure Review Workbench**: PLAN.v2 §31 / `<task_decomposition>` ルールで分割
- **PLAN.v2 改訂**: T200 訂正セクション (`allure agent` 実在等) を PLAN.v2 本体に反映
