# PoC 残作業 (Remaining Work)

Phase 0 / 1 / 1.2 が完了した時点で **PoC を実用化するために残っているギャップ** と **次の Phase に進む前に対応するか判断したい項目** を整理します。

> 本ドキュメントは PLAN.v2.md §31 (Phase Roadmap) / §32 (Success Criteria) / §34 (Open Questions) を参照しています。

---

## 0. ステータス凡例

| バッジ | 意味 |
|---|---|
| 🚧 Blocker | このギャップがあると end-user PoC 体験が破綻する |
| 🟡 Should | 体験向上で対応推奨。但し PoC は回せる |
| 🟢 Nice-to-have | 将来 Phase で対応 |

各項目は **着手前条件** (前提) / **作業範囲** (やること) / **完了条件** (DoD) / **推定工数** を持ちます。`<task_decomposition>` 規模は S (≤0.25d) / M (~1d) / L (>1d) です。

---

## 1. Phase 1.2 完了に向けた follow-up

`IMPLEMENTATION_REPORT.md` 「既知の制約・残課題」を Action item 化したものです。

### 1.1 🟡 [M] AllureReportProvider と RunManager の wire 完了

- **現状**: T202 で `AllureReportProvider` を実装したが、`runManager.ts` の `reportProvider` injection は `playwrightJsonReportProvider` 固定。Allure 経由の summary は `<runDir>/allure-results/` から AllureReportProvider 単体で読めるが、`RunMetadata.summary` には反映されていない。
- **着手前条件**: T202 (PR #36) merged。`<runDir>/allure-results/` が確実に populate されていること (T203-3 完了済)。
- **作業範囲**:
  1. `RunManagerDeps` に `additionalReportProviders?: ReportProvider[]` を追加 (もしくは composite provider を作る)
  2. `readSummarySafely` 経由で複数 provider 結果を merge する関数を作る (Playwright JSON と Allure の重複は Playwright JSON 優先 / Allure の attachments で補強等のルール定義が必要)
  3. T207 `buildQmoSummary` に Allure 由来情報 (broken count / unknown count / attachment 概要) を追加
  4. tests / typecheck
- **完了条件**:
  - Allure-only project (Playwright JSON reporter なし) でも `RunMetadata.summary` が埋まる
  - PR review (silent-failure-hunter) でデータ重複時の優先順位が文書化されている
- **参照**: PLAN.v2 §16

### 1.2 🟡 [M] `useInsightsSummary()` フル置換

- **現状**: T208-2 で `<QmoSummaryBanner />` が live data を出すが、`<InsightsView>` 本体は placeholder。
- **作業範囲**:
  1. `apps/web/src/hooks/use-insights-summary.ts` 新設
  2. `useLatestQmoSummary` + `fetchRuns` + (Phase 1.2 で persisted な history JSONL の reader API → 1.3 と並走) を組み合わせ `InsightsSummary` shape を構築
  3. `apps/web/src/routes/qmo.tsx` で `SAMPLE_INSIGHTS` import を削除して hook 戻り値を渡す
  4. 既存 InsightsView 内 7 cards の placeholder badge を非表示化
  5. tests
- **完了条件**:
  - `/qmo` で表示される 7 cards すべてが live data を反映 (run history があれば)
  - 空プロジェクト時は適切な empty state
- **参照**: `apps/web/src/features/insights-view/types.ts` の Phase 1.2 接続予定 label

### 1.3 🟡 [M] history JSONL reader API + UI

- **現状**: T206 で `allure history --history-path` により履歴 JSONL を生成しているが、Workbench 自身は履歴 JSONL を **読んでいない**。
- **作業範囲**:
  1. agent: `GET /projects/:projectId/allure-history` エンドポイント追加 (`<projectRoot>/.playwright-workbench/reports/allure-history.jsonl` を read + zod validate)
  2. shared: `AllureHistoryEntrySchema` 追加
  3. web: `useAllureHistoryQuery` hook
  4. InsightsView の Allure summary card に live trend 表示
- **完了条件**:
  - 2 回以上 run 実行後、history が pass-rate trend として GUI に出る
  - JSONL 不在 / 破損は warning で degrade

### 1.4 🟡 [S] Profile-driven Quality Gate rules

- **現状**: `runQualityGateStep` は `profile: "local-review"` 固定で CLI defaults を使う。
- **作業範囲**:
  1. `.playwright-workbench/config/quality-gate-profiles.json` 設置 (zod schema 経由 read)
  2. RunRequest に `qualityGateProfile?: QualityGateProfile` を追加
  3. RunManager → `evaluateAllureQualityGate` の `rules` に config 値を渡す
  4. UI で profile 選択
- **完了条件**:
  - `release-smoke` (`maxFailures=0` `successRate=100`) と `full-regression` (`maxFailures=N` `successRate=>=95`) が選べる
- **参照**: PLAN.v2 §23

### 1.5 🟢 [S] Allure quality-gate stdout の構造化 parse

- **現状**: T200 で raw stdout/stderr 保存方針を採用。`exitCode` が 0/1 で意味判定済だが、stdout の "rule 違反内訳" は free text のまま。
- **作業範囲**:
  1. 実機で `allure quality-gate` の stdout 形式を 1 度 sanity-check
  2. 安定 line-format ならば parse 層を追加 (`QualityGateResult.failedRules: string[]` を T205-1 で復活)
  3. JSON 化できなかった行は `extraStdout: string` に保管
- **判断保留**: PLAN.v2 §23 の "raw 保存ファースト" 原則は維持。parse は best-effort の補強のみ。
- **参照**: PLAN.v2 §34 Open Questions

### 1.6 🟢 [S] Allure CLI の version check

- **現状**: T200 で Allure 2 (`allure-commandline`) と Allure 3 (`allure`) を `hasAllureCli` で OR 合算検出。実 binary の version は確認していない。
- **作業範囲**:
  1. Agent 起動時 (project open 直後) に `node_modules/.bin/allure --version` を 1 回 spawn
  2. 戻り値が `3.x` でなければ warning
- **完了条件**: `summary.warnings` に `Allure CLI version is <X>; Phase 1.2 is tested against 3.x.` が追加されること

---

## 2. PoC 配布 / 起動体験

### 2.1 🚧 [L] `npx playwright-workbench` 配布

- **現状**: `pnpm install` + `pnpm dev:agent` + `pnpm dev:web` を起動する形。non-developer が試すには段階多すぎ。
- **着手前条件**: §1 の 1.1〜1.3 で UX が安定してから (頻繁な API 変更が落ち着く)。
- **作業範囲**:
  1. agent 単体の `bin` script を `package.json` に登録
  2. web の build artifact を agent に同梱して static 配信
  3. `--project /abs/path` で開いて自動的にブラウザを開く CLI flow
  4. `npm pack` / `npm publish` 用の単 package 構造 (現状 monorepo)
- **完了条件**: `npx playwright-workbench --project /path` で実行できる
- **参照**: PLAN.v2 §1, §34

### 2.2 🟡 [M] Tauri Desktop sidecar (optional)

- **現状**: PoC は web のみ。Tauri は将来 phase。
- **判断**: 必要ない場合がほとんど。npx 配布 (§2.1) で十分なら見送り。

### 2.3 🟡 [S] Workbench artifact の OS app data 配置 option

- **現状**: `.playwright-workbench/` が project 配下に固定。CI 環境などで project tree を汚したくない場合の回避策がない。
- **作業範囲**:
  1. `WORKBENCH_DATA_DIR` env var を導入 (default: project 配下のまま)
  2. `workbenchPaths(projectRoot)` を `(projectRoot, dataDirOverride?)` に拡張
- **判断保留**: PLAN.v2 §18 の "PoC は project 配下" 原則と緊張関係。優先度低。
- **参照**: PLAN.v2 §34

---

## 3. セキュリティ / 運用 hardening

### 3.1 🟡 [M] `WORKBENCH_ALLOWED_ROOTS` を必須化する mode

- **現状**: 未設定なら任意 absolute path を開ける。multi-tenant / shared 環境ではリスク。
- **作業範囲**:
  1. `WORKBENCH_ENFORCE_ALLOWED_ROOTS=1` で allowlist を必須化
  2. 必須かつ空なら startup error
- **完了条件**: enforced mode で空 allowlist だと startup 失敗

### 3.2 🟢 [S] Audit log の rotate / retention

- **現状**: `.playwright-workbench/audit.log` は append-only。長期 run で肥大化。
- **作業範囲**: max size / max age policy。LOW priority — `pnpm test` で truncate しているケースが多く実運用でも数 MB 規模。

### 3.3 🟡 [S] Run cancellation 経路の test 強化

- **現状**: `cancelRun` は active runs のみ対応。Allure CLI subprocess 中に cancel した時の挙動 (timeout 経路と分岐) は test されていない。
- **作業範囲**: integration test で cancel が generate / quality-gate subprocess に届くことを assertion

### 3.4 🟢 [S] Symlink 経路を `tests/` でも検証

- **現状**: T203-2 / T204 で symlink skip は実装済 + unit test 済 (path-redaction policy)。production fixture (`tests/fixtures/sample-pw-allure-project/`) では試験していない。
- **作業範囲**: integration test で fixture 内に symlink を仕込み、Workbench が拒否することを確認

---

## 4. PoC 段階で解消すべき UX gap

### 4.1 🟡 [M] Allure HTML report の埋め込み viewer (基本版)

- **現状**: `<runDir>/allure-report/index.html` を OS の `open` で開く必要あり。GUI 内 viewer なし。
- **作業範囲**:
  1. agent: `GET /runs/:runId/allure-report/*` で static 配信 (path-traversal guard 必須)
  2. web: `<iframe sandbox>` で表示
- **完了条件**: GUI 内で Allure UI が見られる
- **判断保留**: Phase 6 (Playwright Operations GUI) で UI Mode / Trace Viewer / Codegen と一括対応する予定。先行採用するか後回しか要判断。

### 4.2 🟡 [M] Run controls で実行範囲を絞れる UI

- **現状**: GUI からは現状 "Run all" のみ。`grep` / `--project` / spec path 指定は API レベルでは可能だが UI 未公開。
- **作業範囲**:
  1. RunControls に grep / project / spec list 選択を追加
  2. Test Inventory から checkbox で spec / test 選択
- **参照**: PLAN.v2 Phase 6

### 4.3 🟡 [S] StatusBar に WS 接続状態の indicator

- **現状**: WS 切断時に "stale" 状態を表示する仕組みがない。
- **作業範囲**: `useWorkbenchEvents` で WS state を `connected | reconnecting | disconnected` に分け StatusBar に出す

### 4.4 🟢 [S] /qmo route で run 切替

- **現状**: 最新 run のみ。
- **作業範囲**: route を `/qmo/$runId` に変更 (TanStack Router) + run picker。
- **判断保留**: Phase 6 まで保留。

---

## 5. ドキュメント / DX

### 5.1 🟡 [S] PLAN.v2 訂正セクションの本体取り込み

- **現状**: T200 訂正セクション (`allure agent` / `allure log` 実在確認 / history JSONL 確定) は `docs/design/phase-1-2-allure-investigation.md` にのみ存在。PLAN.v2.md §10 / §22 / §34 / §38 にはまだ反映されていない。
- **作業範囲**: PLAN.v2.md を直接編集して訂正を反映 (PR #34 メモは履歴として残す)。
- **完了条件**: `allure agent コマンド is not defined` 等の古い記述が PLAN.v2 から消える

### 5.2 🟢 [S] CHANGELOG.md 整備

- **現状**: 19 PR が main に積まれているが CHANGELOG なし。Phase 1.2 完了を milestone として記録すると `npm publish` 後の release notes に流用しやすい。

### 5.3 🟢 [S] 開発者向け CONTRIBUTING.md / コントリビューションガイド

- 既存 CONTRIBUTING.md が薄い。Phase 1.2 でコードベースに導入された pattern (FATAL_OPERATIONAL_CODES / Issue #31 axes / path-redaction policy) をルール化して新規コントリビュータに伝える。

---

## 6. Phase 1.5 / Phase 2 への移行判断

PLAN.v2 §31 では Phase 1.2 → Phase 1.5 (Bun spike) → Phase 2 (Failure Review Workbench) の順を提案。

### 6.1 Phase 1.5 (Bun feasibility spike) 着手判断

- **必須前提**: Phase 1.2 PoC を実機で 1 度通したこと (`docs/operations/poc-guide.md` シナリオ 2 を完走)
- **やること**: PLAN.v2 §30
- **想定工数**: M (検証中心、production code 変更は最小)

### 6.2 Phase 2 (Failure Review Workbench) 着手判断

- **必須前提**:
  - 上記 §1.1〜§1.3 (Allure provider wire / InsightsView 置換 / history reader) のうち最低 1.1 と 1.3 が完了していること (失敗詳細表示の Source of Truth が整う)
  - もしくは Phase 1.2 を「PoC 検証完了」として明示的にクローズ
- **想定工数**: L (PLAN.v2 §32 の Phase 2 success criteria 全達成で複数 PR 必要)

---

## 7. 優先度 マトリックス

| 優先度 | 項目 | バッジ |
|---|---|---|
| 1 (即時着手推奨) | §5.1 PLAN.v2 訂正取り込み / §1.1 AllureReportProvider wire | 🟡 |
| 2 (PoC 配布前) | §2.1 npx 配布 / §1.2 InsightsView 置換 / §1.3 history reader | 🚧 / 🟡 |
| 3 (Phase 2 着手前) | §1.4 Profile-driven QG / §3.1 enforce allowlist mode | 🟡 |
| 4 (Phase 6 と統合) | §4.1 Allure viewer / §4.2 Run controls UI / §4.4 run picker | 🟡 |
| 5 (LOW) | §3.2 / §3.4 / §5.2 / §5.3 / §1.5 / §1.6 / §2.2 / §2.3 | 🟢 |

---

## 8. 関連ドキュメント

- 操作マニュアル: [`./poc-guide.md`](./poc-guide.md)
- 全体計画: [`../../PLAN.v2.md`](../../PLAN.v2.md)
- Phase 1.2 完了報告: [`../../IMPLEMENTATION_REPORT.md`](../../IMPLEMENTATION_REPORT.md)
- 設計メモ群: `docs/design/`
