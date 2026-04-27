# Playwright-native QA Workbench PLAN.md (v2)

## 1. Executive Summary

このプロダクトは、既存のPlaywrightプロジェクトをSource of Truthとして扱うローカルファーストGUIです。GUI独自DSLやノーコード変換基盤ではなく、Playwrightコード、Git diff、公式CLI、公式artifact、Allure Report 3を束ねるControl Plane / Workbenchとして設計します。

PoCではクラウドバックエンドとDBを持たず、Workbench本体はpnpm workspace、FrontendはVite + React、Local AgentはNode.js + Hono + WebSocketで開始します。対象Playwrightプロジェクトは npm / pnpm / yarn / bun を検出して実行します。

配布形態はnpm packageとし、`npx playwright-workbench --project <path>` でLocal Agentを起動、ブラウザでGUIを開く。対象プロジェクトへの強制的なdevDependency追加は行わない。Tauri Desktop化は将来Phaseとして残す。

現時点のリポジトリはテンプレート状態で、実体コードはありません。

## 2. Product Vision

Playwrightを隠すGUIではなく、QA組織がPlaywrightを運用できるWorkbenchにする。

中核価値は次の3つです。

- QAはコードを深く読まずに、テスト目的、実行結果、失敗証跡、品質判断を理解できる。
- 開発者 / SDETはPlaywrightコード、fixture、POM、config、Git diff、CLI/CI適合性を維持できる。
- QMO / Release OwnerはAllure Report 3、Quality Gate、履歴、flaky傾向、known issues、AI要約を使って証跡付き判断ができる。

## 3. Target Users / Personas

- 開発エンジニア / SDET: 既存Playwright資産を壊さず、AI修正案をdiffとしてレビューし、CLI/CIで再現できることを重視する。
- QAエンジニア: GUIから実行し、失敗理由、trace、screenshot、video、Allure履歴を見て、テスト修正かプロダクト不具合かを判断したい。
- QMO / QA Lead / Release Owner: Quality Gate、known issues、flaky傾向、PR/Issue/CI artifactとの紐付けを見てリリース判断したい。

## 4. Goals / Non-goals

Goals:

- 既存Playwrightプロジェクトを読み込み、spec/test inventoryを表示する。
- GUIからPlaywright CLIを実行し、stdout/stderrをリアルタイム表示する。
- Playwright JSON / HTML / Allure results / Allure Report 3をrun単位で保存する。
- Allure history、Quality Gate、known issues、CSV/log出力をWorkbenchの品質証跡として扱う。
- AI分析と修正提案はdiff、根拠、リスク、再実行結果とセットでレビューする。
- GUIによる変更はGit diffとして確認できる形に限定する。

Non-goals:

- Playwrightを独自DSLへ変換しない。
- UI Mode、Trace Viewer、Codegen、HTML reporter、Allure Report UIを再実装しない。
- PoCでクラウド、DB、中央TestOps、ユーザー管理、権限管理を作らない。
- AIによる自動merge、自動修正、自動self-healingをしない。

## 5. Core User Flows

1. Project Open: ユーザーがPlaywright project rootを選択し、package manager、config、spec、projects、reporter設定を検出する。
2. Test Inventory: spec/test/describe/tag/locator/assertionを一覧し、QA ViewとDeveloper Viewを切り替える。
3. Run: spec単位、test単位、grep/tag/project指定で実行し、stdout/stderrをリアルタイム表示する。
4. Evidence: JSON result、Allure results、Allure HTML、Playwright HTML、trace/screenshot/video/logをrun metadataへ紐付ける。
5. Failure Review: 失敗原因、stack、該当コード、artifact、Allure履歴、known issue、flaky傾向を確認する。
6. AI Analysis: 失敗contextをAI CLIに渡し、原因分類、根拠、リスク、proposed patchを構造化出力で受け取る。
7. Repair Review: patchを `git apply --check` で検証し、一時適用、再実行、修正前後のAllure/JSON/Quality Gate比較を行う。
8. QMO Review: Release Readiness Summary、Quality Gate結果、Allure report link、失敗分類をPR/Issue用文面にまとめる。

## 6. Recommended Architecture

構成:

React GUI  
→ HTTP / WebSocket  
→ Local Node Agent  
→ file system / process  
→ User Playwright Project  
→ Playwright JSON / HTML / Allure Report 3 / artifacts

責務分離:

- Frontend: 表示、操作、diff review、artifact viewer、run console。
- Local Agent: project scan、AST解析、コマンド実行、report/artifact管理、AI/Git adapter。
- User Project: Playwrightコード、config、fixture、POM、Git履歴のSource of Truth。
- Reporting Layer: Allure-firstだが `ReportProvider` でPlaywright JSON / CTRF / ReportPortalへ拡張。

## 7. Technology Stack Decision

PoC:

- Monorepo: pnpm workspace, TypeScript, zod schemas, pnpm scripts。
- Frontend: Vite, React, TanStack Router, TanStack Query, Zustand, Tailwind CSS, shadcn/ui, Monaco Editor, xterm.js。
- Agent: Node.js, TypeScript, Hono, @hono/node-server, WebSocket (ws), node:child_process, simple-git, zod, pino。
- Reporting: Playwright JSON, Playwright HTML, allure-playwright, Allure Report 3。
- Storage: `.playwright-workbench/` 配下のJSON/file store。

本運用候補:

- Desktop: Tauri v2 + Node.js sidecar。
- Agent: Node sidecarを継続し、CommandRunner抽象を維持。
- Storage: JSON file store継続、必要時SQLite。クラウド同期が必要になってからPostgres等を検討。

HonoをPoCのAgentに選ぶ理由は、Web Standards準拠でBun/Tauri移行パスと相性が良く、Local AgentのAPI面が薄いため軽量フレームワークで十分であるためです。WebSocketは `@hono/node-ws` を第一候補とするが、安定性に問題がある場合は `@hono/node-server` が公開する `http.Server` 上で `ws` ライブラリを直接使うフォールバックを用意する。ts-morphはPhase 5以降で導入し、PoCでは使わない。

## 8. Package Manager / Runtime Decision

Workbench本体:

- package manager: pnpm。
- runtime: Node.js。
- task runner: pnpm scripts。
- Turborepo / Nx: 初期PoCでは導入しない。

ユーザー側Playwrightプロジェクト:

- npm: `package-lock.json`
- pnpm: `pnpm-lock.yaml`
- yarn: `yarn.lock`
- bun: `bun.lock` または `bun.lockb`

検出優先順位:

1. Workbench project settingsの明示override（最優先）。
2. `package.json` の `packageManager` フィールド（corepack指定）。
3. lockfileが1種類だけ存在する場合はそのpackage manager。
4. 複数lockfileがあり、`packageManager` がない場合は**ambiguousとして実行をブロック**し、GUIでユーザーに選択を必須とする。暫定defaultによる自動決定はしない。
5. lockfileなしの場合はnpm fallback。ただし警告を表示する。

実行コマンド生成:

- npm: `npx playwright test`
- pnpm: `pnpm exec playwright test`
- yarn: `yarn playwright test`
- bun: `bunx playwright test`

CommandRunnerではshell stringではなく、必ずcommand + args配列として保持する。

Bun:

- PoC標準runtime/package managerにはしない。
- ユーザー側プロジェクトがBunの場合の実行対象として扱う。
- Phase 1.5でBunCommandRunnerとTauri sidecar可能性を検証する。

## 9. Reporting / Quality Evidence Decision

初期はAllure Report 3-firstとする。

併用するreporter:

- `list`: CLI/console用。
- `json`: Workbench解析、QMO summary、AI context用。
- `html`: Playwright標準デバッグの保険。
- `allure-playwright`: 品質証跡、履歴、Quality Gate、known issues、CSV/log出力用。

Allure-firstの理由:

- ローカルファーストと相性が良く、DB不要。
- 静的HTMLとしてartifact保存、GitHub Actions artifact、静的ホスティングへ載せやすい。
- Allure 3はplugin、history、known issues、Quality Gate、CSV/log出力を持ち、PoCの品質判断に十分な可能性がある。
- ReportPortalほど重い中央運用を最初から背負わなくてよい。
- Playwright JSONと併用しやすく、AI/QMO向け成果物に変換しやすい。

## 10. Allure Report 3 Integration Strategy

基本方針:

- テストコードはPlaywright標準の `test.step()` と `testInfo.attach()` を中心にする。
- Allure固有metadata/labelは薄いhelper/adapter経由にする。
- WorkbenchはAllureを品質証跡providerとして読むが、PlaywrightコードのSource of Truthにはしない。
- Allure導入が必要な場合は、既存configを自動変更せず、差分提案として提示する。

run出力:

- `allure-results`: run単位で `.playwright-workbench/runs/<runId>/allure-results/` に保存。
- `allure-report`: run単位で `.playwright-workbench/runs/<runId>/allure-report/` にHTML生成。加えて `.playwright-workbench/latest-report/` に最新runのコピーまたはシンボリックリンクを置く。
- `allure-history.jsonl`: project単位の継続履歴として `.playwright-workbench/allure-history.jsonl` に保存。
- `quality-gate-result.json`: exit code、失敗rule、stdout/stderr、profileを `.playwright-workbench/runs/<runId>/quality-gate-result.json` に保存。stdoutのJSON parse可能性は実装時にCLI helpで確認し、まずはraw出力保存を優先する。
- `allure csv` / `allure log`: AI/QMO向け補助出力として `.playwright-workbench/runs/<runId>/allure-exports/` に保存。

AI/QMO向けsummaryは `allure agent` コマンドに依存せず、Workbench側で `allure log` / `allure csv` 出力、raw `allure-results` JSON、Playwright JSON reporter結果からMarkdown/JSON summaryを生成する。

Allure CLI / adapterの正確なpackage名、CLI構文、設定方法は実装直前に公式docsで再確認する。2026-04-27時点では、公式docsはAllure 3のNode install、`allurerc.*`、`historyPath`、Quality Gate、CSV/log plugin、Playwright adapterの `allure-playwright` を案内している。`allure agent` コマンドは2026-04-27時点で公式docsに記載が見つからないため、依存しない。

## 11. ReportPortal Re-evaluation Strategy

ReportPortalは初期採用しない。

再評価条件:

- 複数チーム/複数プロジェクトの共同triageが必要。
- ユーザー、権限、担当者、状態、分類を中央管理したい。
- Jira等Issue Trackerと深く連携したい。
- 長期横断分析、検索、dashboard、ML triageが必要。
- Allureのfile-first/static-first運用でlaunch数、履歴、検索性が限界になる。

将来導入する場合:

- Allureから完全移行しない。
- `ReportProvider` に `ReportPortalProvider` を追加する。
- 新規runからReportPortalへ送信し、過去Allureレポートは静的アーカイブとして保持する。
- Allure historyとReportPortal historyを無理に完全統合しない。

## 12. Monorepo Structure

PoC構成（Phase 1〜4）:

- `apps/web`: React GUI。
- `apps/agent`: Local Node Agent。CommandRunner、PackageManagerDetector、ReportProvider、Git adapter、AI adapterは全て `apps/agent/src/` 内に配置する。
- `packages/shared`: zod schemas、API types、domain types。

将来的な抽出候補（境界が固まってから段階的に分離）:

- `packages/playwright-model`: AST解析、inventory model（Phase 5以降）。
- `packages/reporting`: ReportProvider、AllureReportProvider、PlaywrightJsonProvider。
- `packages/command-runner`: CommandRunner abstraction、NodeCommandRunner。
- `packages/git-adapter`: Git status/diff/patch操作。
- `packages/ai-adapter`: Codex/Claude/Gemini/custom CLI adapter。

最初から細かいpackagesに分けすぎない。PoC段階で境界が不安定なまま分割するとリファクタリングコストが増大する。

## 13. Local Agent Design

Local Agent責務:

- project root検証、realpath解決、root外アクセス制限。
- package.json、lockfile、playwright.config検出。
- spec/test inventory抽出。
- PackageManagerDetector実行。
- Playwright command build。
- CommandRunner経由の安全なprocess実行。
- stdout/stderr/test progressのstreaming。
- JSON/HTML/Allure成果物の保存。
- Allure report generation、Quality Gate、CSV/log出力。
- Git status/diff/apply-check/apply/revert。
- AI context生成、AI CLI実行、structured output validation。
- run metadata/file store管理。

AgentはViteの責務を持たない。ViteはFrontend dev/build専用。

## 14. CommandRunner Design

責務:

- command + args配列での実行。
- stdout/stderr streaming。
- exit code、signal、duration、pid取得。
- timeout、cancellation。
- cwd/env制御。
- allowed command policy。
- project root外アクセス抑制。
- audit log保存。
- secret redaction。

interface上の概念:

- `CommandSpec`: executable、args、cwd、env、timeout、policyId。
- `CommandExecution`: runId、commandId、status、exitCode、stdout/stderr streams。
- `CommandPolicy`: allowed binaries、allowed args pattern、cwd boundary、env allowlist。

初期実装:

- `NodeCommandRunner`: `node:child_process.spawn` ベース。`execa` は必須にしない。
- shellは使わない。
- `npm run <script>` はPoCでは原則禁止。必要な場合は明示許可UIを追加する。
- `git apply --check`、`git diff`、`git status`、package manager経由Playwright、Allure CLI、AI CLIのみ許可する。

将来:

- `BunCommandRunner`
- `TauriCommandRunner`
- `MockCommandRunner`

## 15. PackageManagerDetector Design

検出入力:

- projectRoot
- package.json
- lockfiles
- user override
- available binaries

出力:

- detected manager
- confidence
- reason
- warnings
- command templates
- binary availability
- ambiguous lockfile list

複数lockfile時:

- UIで警告。
- `packageManager` があればそれを採用。
- ない場合は**ambiguousとしてテス��実行をブロック**し、GUIでユーザーに選択を必須とする。暫定defaultによる自動決定はしない。
- 検出結果をrun metadataへ保存する。

Allure関連コマンドもpackage managerごとに抽象化する。例: project-local Allureを使う場合は npm/pnpm/yarn/bunのexec差分を隠す。

## 16. ReportProvider / AllureReportProvider Design

`ReportProvider` の責務:

- run result summary取得。
- failed tests取得。
- artifact一覧取得。
- history/flaky/known issue情報取得。
- quality gate結果取得。
- AI/QMO向けsummary生成。
- provider固有artifact pathを共通modelへ正規化。

Provider候補:

- `AllureReportProvider`: Allure results、HTML report、history JSONL、known issues、CSV/log、Quality Gateを読む。
- `PlaywrightJsonReportProvider`: Playwright JSON reporter出力を読む。
- `CtrfReportProvider`: 将来追加。
- `ReportPortalProvider`: 将来追加。remote API前提。

Allure固有概念はdomain modelに直接漏らしすぎない。Workbench内部は `TestRun`, `TestCaseResult`, `EvidenceArtifact`, `QualitySignal`, `KnownIssue`, `FlakySignal` に正規化する。

## 17. Frontend Design

主要画面:

- Project Picker / Project Health
- Test Inventory
- Run Console
- Failure Detail
- QA View
- Developer View
- QMO View
- Artifact Viewer
- Allure Report Link / embedded static viewer候補
- Quality Gate Panel
- AI Analysis View
- Diff Review
- Config / Fixture / POM Explorer
- Settings

情報設計:

- QA View: テスト目的、操作ステップ、期待結果、失敗理由、証跡、known issue/flaky。
- Developer View: spec path、line、stack、locator/assertion、fixture/POM、Git diff、rerun command。
- QMO View: run summary、Quality Gate、Allure link、失敗分類、flaky傾向、known issues、release readiness。

## 18. Storage Strategy

PoCはDBなし。対象プロジェク���配下に `.playwright-workbench/` を作る設計とする。

構造案:

- `.playwright-workbench/config/workbench.json`
- `.playwright-workbench/reports/allure-history.jsonl`
- `.playwright-workbench/reports/known-issues.json`
- `.playwright-workbench/latest-report/` (最新runのallure-reportへのコピーまたはシンボリックリンク)
- `.playwright-workbench/runs/<runId>/metadata.json`
- `.playwright-workbench/runs/<runId>/stdout.log`
- `.playwright-workbench/runs/<runId>/stderr.log`
- `.playwright-workbench/runs/<runId>/playwright-results.json`
- `.playwright-workbench/runs/<runId>/playwright-report/`
- `.playwright-workbench/runs/<runId>/allure-results/`
- `.playwright-workbench/runs/<runId>/allure-report/`
- `.playwright-workbench/runs/<runId>/allure-exports/` (csv/log出力)
- `.playwright-workbench/runs/<runId>/quality-gate-result.json`
- `.playwright-workbench/runs/<runId>/artifacts.json`
- `.playwright-workbench/runs/<runId>/ai-analysis.json`
- `.playwright-workbench/runs/<runId>/patch.diff`
- `.playwright-workbench/runs/<runId>/reruns/<rerunId>/...`

`.playwright-workbench/` は通常git管理対象外にする。Workbenchは初回に `.gitignore` 追加diffを提案するが、自動適用しない。

Allure reportはrun単位で保存する。「最新reportだけを保持」する設計は証跡保存に弱いため採用しない。`latest-report/` は表示用の便宜的リンクにすぎない。

## 19. API Design

HTTP API案:

- `GET /health`
- `POST /projects/open`
- `GET /projects/current`
- `GET /projects/:projectId/inventory`
- `GET /projects/:projectId/config-summary`
- `GET /projects/:projectId/git/status`
- `POST /runs`
- `GET /runs`
- `GET /runs/:runId`
- `POST /runs/:runId/cancel`
- `GET /runs/:runId/artifacts`
- `GET /runs/:runId/report-summary`
- `GET /runs/:runId/quality-gate`
- `POST /ai/analyze`
- `POST /patches/check`
- `POST /patches/apply-temporary`
- `POST /patches/revert-temporary`
- `POST /qmo/release-summary`

全APIは `packages/shared` のzod schemaでrequest/responseを定義する。

## 20. WebSocket / Streaming Design

WebSocket channel:

- `/ws`

Event types:

- `run.started`
- `run.stdout`
- `run.stderr`
- `run.test.started`
- `run.test.finished`
- `run.artifact.detected`
- `run.allure.results-ready`
- `run.allure.report-generated`
- `run.quality-gate.finished`
- `run.completed`
- `run.cancelled`
- `run.error`
- `ai.started`
- `ai.chunk`
- `ai.completed`
- `patch.applied`
- `patch.reverted`

各eventは `runId`, `sequence`, `timestamp`, `payload` を持つ。Frontendはsequenceで順序保証し、再接続時はHTTPでrun snapshotを取り直す。

## 21. Playwright Integration Design

実行方針:

- package managerに応じたPlaywright commandを生成する。
- spec単位はpath filterで実行。
- test単位はPlaywrightの `--test-list` を第一候補にする。
- grep/tag/project/headed/headless/retries/workers/trace/screenshot/videoはPhase 6でGUI操作対象に拡張する。
- UI Mode、Trace Viewer、Codegenは再実装せず、該当CLIを起動またはartifact linkを表示する。

Reporter方針:

- PoCの基本は `list`, `json`, `html`。
- Phase 1.2で `allure-playwright` を追加。
- JSON outputはrun dirへ固定。
- HTML/trace/screenshot/videoもrun metadataへ紐付ける。

## 22. Allure Report 3 Integration Design

Allure出力方針:

- Allure results: `.playwright-workbench/runs/<runId>/allure-results`
- Allure report: `.playwright-workbench/runs/<runId>/allure-report`
- Latest report: `.playwright-workbench/latest-report/` (最新runへのリンク)
- History: `.playwright-workbench/reports/allure-history.jsonl`
- Known issues: `.playwright-workbench/reports/known-issues.json`
- CSV/log: `.playwright-workbench/runs/<runId>/allure-exports/`

実行設計:

- Playwright実行でAllure resultsを生成。
- Allure CLIでHTML reportを生成。
- `--config`, `--output`, `--history-path` などのCLI overrideを使い、run単位の出力先を制御する。
- `allure quality-gate` を実行してQuality Gate結果を保存する。
- fastFailが必要な本運用では `allure run -- <test command>` を検討する。

既存projectがAllure未導入の場合:

- PoCでは「Allure setup required」と表示し、必要なdependencies/configのdiff案を生成する。
- 自動適用はしない。
- 検証用fixture projectではAllure導入済みにしてPhase 1.2を証明する。

## 23. Quality Gate Design

Quality Gate profile:

- `local-review`: 選択run向け。`maxFailures: 0` を基本にし、結果はadvisoryとして保存。
- `release-smoke`: smoke/release候補。`maxFailures: 0`, `successRate`閾値、必要なら `minTestsCount`。
- `full-regression`: full suite向け。`successRate`, `maxFailures`, `maxDuration`, `minTestsCount` を使う。

保存内容:

- profile
- rules
- exitCode
- status
- failedRules
- stdout (raw保存。JSON parseが可能かはCLI help確認後にparse層を追加する)
- stderr (raw保存)
- Allure report path
- evaluatedAt
- known issues除外の有無

`allure quality-gate` のstdout出力形式が正確にJSON前提で設計しない。まずはexitCode + stdout/stderr + evaluatedAtのraw保存を基本とし、CLI help確認後に構造化parse層を追加する。retriesとの非互換もUIで明示警告する。

Quality Gateを通過しても自動mergeしない。QMO Viewの判断材料にする。

## 24. AST Analysis Strategy

Phase 1（PoC）:

- `playwright test --list` を権威ソースとし、Playwrightが認識するtest一覧をそのまま使う。
- `--list` の出力形式（デフォルトのテキスト形式）をパースしてテスト構造に変換する。`--list --reporter=json` は確定仕様として固定せず、実装時に出力安定性を検証した上で採用判断する。
- ts-morphはPhase 1では導入しない。

Phase 5/7（ts-morph導入後）:

- `ts-morph` でspecから `test`, `test.describe`, `test.step`, `expect`, locator呼び出しを抽出。
- Playwright configからprojects、use、reporter、trace/screenshot/video設定を抽出。
- fixture依存関係。
- POM class一覧、locator一覧。
- 重複locator、脆いlocator候補。
- storageState/auth setup。
- tag/suite/Allure metadata。

ASTで完全理解できない箇所はunknownとして表示し、勝手に書き換えない。

## 25. Git / Patch Management Strategy

Git操作:

- `git status --porcelain`
- `git diff`
- `git diff --stat`
- `git apply --check`
- temporary patch apply
- revert temporary patch
- PR body / issue comment draft生成

安全策:

- dirty worktreeを検出し、パッチ対象ファイルに未コミットの変更がある場合は**AI patch適用をブロック**する。自動stashは行わない（stash操作はユーザーの意図しない変更退避・復元失敗のリスクがある）。
- user変更を上書きしない。
- patch適用は必ず `apply --check` を先に行う。
- temporary apply後はrerunし、結果を保存してからapprove/reject判断。
- reject時は `git apply --reverse` で適用したpatchだけを戻す。無関係変更は触らない。
- 将来的にはtemporary worktreeでpatch検証する方式を検討する。

## 26. AI Adapter Design

Adapter候補:

- Codex CLI
- Claude Code
- Gemini CLI
- Custom command

AI context:

- failed test summary
- Playwright JSON result
- Workbench生成のAllure failure summary（`allure log` / `allure csv` 出力 + raw allure-results JSONから生成）
- Quality Gate result（exitCode + raw stdout/stderr）
- history/flaky/known issue
- stack trace
- relevant source snippets
- locator/assertion抽出
- artifact manifest
- git diff/status
- rerun command

渡さないもの:

- `.env`
- credentials
- secrets
- storageStateのtoken値
- cookies/localStorage本文
- raw trace/log内のsecret候補

AI output schema:

- classification
- rootCause
- evidence
- risk
- proposedPatch
- filesTouched
- rerunCommand
- confidence
- requiresHumanDecision

AIはファイルを直接変更しない。Workbenchがpatch/diffとして受け取り、人間レビュー後に一時適用する。

## 27. QMO / Release Readiness Design

QMO Viewに表示するもの:

- run summary
- Quality Gate status
- failed/broken/skipped/pass数
- critical failures
- known issues
- flaky candidates
- previous run comparison
- Allure report link
- Playwright report link
- artifact links
- AI Release Readiness Summary
- PR/Issue/CI artifact links

Release Readiness Summary:

- 結論: ready / not ready / conditional
- blocking failures
- non-blocking known issues
- flaky risk
- evidence links
- recommended next action
- generatedAt, runId, commit SHA

## 28. Security Model

主要リスク:

- ローカル任意コマンド実行。
- path traversal。
- project root外ファイルアクセス。
- package manager script経由の任意実行。
- AI CLIへのsecret流出。
- trace/log/reportへのsecret混入。
- patchによるuser変更破壊。
- Allure CLIのcwd/output path誤設定。

対策:

- CommandRunnerに実行を集約。
- shell不使用、args配列のみ。
- realpathでproject root配下に制限。
- allowed command policy。
- env allowlist + secret redaction。
- artifact scanningでsecret候補を警告。
- AI context builderで機密ファイル除外。
- patch apply前のdiff確認と `git apply --check`。
- audit log保存。
- Tauri移行時はshell plugin scopeを最小化する。

## 29. PoC Scope

Phase 1で作る:

- pnpm workspace skeleton。
- apps/web + apps/agent + packages/shared。
- project root open。
- Playwright project検出。
- PackageManagerDetector。
- spec/test inventory。
- NodeCommandRunner。
- GUIからspec/test run。
- stdout/stderr streaming。
- JSON result保存。
- basic pass/fail/failure detail。

Phase 1.2で作る:

- Allure adapter検出。
- Allure results保存。
- Allure Report 3 HTML生成。
- Allure report path/link表示。
- Quality Gate実行と保存。
- Allure history JSONL保存。
- CSV/log出力確認。
- QMO summary v0。

PoCで作らない:

- Tauri desktop packaging。
- SQLite。
- ReportPortal。
- full self-healing。
- config/POMの自由編集。
- 複数チーム共有。

## 30. Bun Feasibility Spike Plan

目的:

- Bunをユーザー側package managerとして扱えるか検証する。
- BunCommandRunnerを実装すべきか判断する。

検証:

- `bun.lock` / `bun.lockb` 検出。
- `bunx playwright test` 実行。
- stdout/stderr streaming。
- JSON reporter。
- Allure results。
- Allure report generation。
- trace/screenshot/video収集。
- Git/patch/AI CLIとのstdio安定性。
- macOS/Windows/Linux差分。
- Tauri sidecar化の見通し。

成果物:

- Bun feasibility report。
- Node継続理由。
- Bun対応をPhaseに入れる条件。
- BunCommandRunner設計案。

## 31. Detailed Phase Roadmap

Phase 0: Product Definition / Architecture  
このPLANを確定し、Source of Truth、security、reporting、package manager、roadmapを固定する。

Phase 1: Local Runner PoC  
GUIからPlaywrightを実行し、JSON resultとstdout/stderrを扱えることを証明する。

Phase 1.2: Allure Report 3 Integration PoC  
Allure results、HTML、history、Quality Gate、CSV/log、QMO summaryを統合する。

Phase 1.5: Bun Feasibility Spike  
Bunを標準ではなく検証対象として評価する。

Phase 2: Failure Review Workbench  
QAが失敗詳細、artifact、Allure履歴、flaky/known issueを理解できる画面を作る。

Phase 3: AI Analysis / Repair Proposal  
AIが原因分類、根拠、リスク、patch案を構造化出力する。

Phase 4: Repair Review / Evidence-based Approval  
diff review、一時patch、rerun、前後比較、approve/rejectを作る。

Phase 5: Test Inventory / QA Understanding Layer  
テスト意味、操作、期待結果、locator/assertion、Allure metadataをQA向けに表示する。

Phase 6: Playwright Operations GUI  
headed/headless、browser project、grep/tag、retries、workers、trace、video、UI Mode、Trace Viewer、Codegen起動を統合する。

Phase 7: Config / Fixture / POM Explorer  
config、fixture、POM、locator、storageState、重複/脆弱locator候補を可視化する。

Phase 8: GitHub / CI Integration  
PR/Issue作成、CI artifact import、Allure artifact import、release readiness PR commentを作る。

Phase 9: AI Test Planning / Generation Gateway  
Playwright MCP/Test Agentsのplanner/generator/healer結果をdiff reviewに流す。

Phase 10: ReportPortal Re-evaluation  
中央TestOpsが必要かを判断し、ReportProvider拡張で並行運用する。

## 32. Success Criteria for Each Phase

Phase 1:

- 既存Playwright projectを開ける。
- package managerを検出できる。
- spec/test一覧を表示できる。
- GUIからrunできる。
- stdout/stderrをリアルタイム表示できる。
- Playwright JSONを保存・解析できる。

Phase 1.2:

- Allure resultsがrun単位で保存される。
- Allure HTML reportが生成される。
- Allure report linkがGUIに出る。
- Quality Gate結果が保存・表示される。
- history JSONLが継続保存される。
- QMO summary v0が生成される。

Phase 2:

- 失敗testごとにstack、artifact、Allure履歴、known issue/flakyが確認できる。

Phase 3:

- AI分析がzod validationを通る。
- proposed patchがdiffとして表示され、直接適用されない。

Phase 4:

- patch check、temporary apply、rerun、before/after comparisonができる。

Phase 5:

- QAがコードを深く読まずにテスト目的と期待結果を理解できる。

Phase 6:

- Playwright主要CLI機能をGUIから安全に操作できる。

Phase 7:

- config/fixture/POMの構造と保守リスクが可視化される。

Phase 8:

- PR/Issue/CI artifact/Allure reportを紐付けたレビュー導線ができる。

Phase 9:

- AI生成テストがdiff reviewとQuality Gateを通る運用になる。

Phase 10:

- Allure継続、ReportPortal追加、並行運用の判断材料が揃う。

## 33. Risks and Mitigations

- Allure 3の仕様成熟度リスク: 実装前に公式docs/CLI help/package versionを確認し、ReportProviderで閉じ込める。
- Allure依存過多: test codeはPlaywright標準step/attach中心にする。
- package manager差分: PackageManagerDetectorとCommandBuilderで分離する。
- 任意コマンド実行: CommandRunner policyで許可制にする。
- AIの誤修正: diff review、根拠、risk、rerun必須にする。
- locator修正がproduct bugを隠す: failure classificationとQMO approvalを必須にする。
- artifact肥大化: retention、compression、archive policyをPhase 2以降で追加する。
- dirty worktree破壊: パッチ対象ファイルに未コミット変更がある場合はpatch適用をブロックする。自動stashは行わない。将来的にtemporary worktreeで検証する方式を検討する。
- @hono/node-ws の安定性: WS streaming不能時は `ws` ライブラリ直接使用にフォールバック。`createApp()` ファクトリで差し替え可能に設計する。
- Tauri移行負荷: Agent APIをHTTP/WSで保ち、sidecar化だけにする。

## 34. Open Questions

実装前に確認する事項:

- Allure Report 3 / Allure CLI / allure-playwrightの正確な最新package名、version、CLI syntax。
- Allure resultsDirをCLI/envでrun単位に制御する最適手段（`--output`, `--history-path` 等のCLI override）。
- `allure quality-gate` のstdout出力形式（JSON前提にせず、まずraw保存）。
- `allure quality-gate` と `allure run` のPoC採用順。
- `allure log` / `allure csv` の出力形式とAI context生成への利用方法。
- `playwright test --list` の出力パース安定性（`--reporter=json` との併用検証を含む）。
- `@hono/node-ws` のWebSocket安定性（大量stdout/stderr streaming、切断・再接続時の挙動）。
- Workbench artifactをproject配下に置くか、OS app dataへ置くoptionを持つか。
- 初期AI adapterの優先順位。
- Windows対応をPoCに含めるか、Phase 2以降にするか。
- QMO Quality Gate default thresholdを組織ごとにどう設定するか。
- `npx playwright-workbench` の配布パッケージ名とCLI引数設計（`--project <path>`, `--port <number>` 等）。

この計画のdefaultは、macOS/Linux中心のPoC、project配下file store、Codex CLI adapter優先、Quality Gateはadvisory保存から開始。

## 35. First Implementation Tasks

1. `PLAN.md` を保存する。
2. pnpm workspaceを作成する。
3. `packages/shared` にdomain schemaを作る。
4. `apps/agent` にHono + WebSocket serverを作る。
5. `apps/web` にVite + React shellを作る。
6. PackageManagerDetectorを実装する。
7. CommandRunner / NodeCommandRunnerを実装する。
8. Project scannerを実装する。
9. Test inventory APIを実装する。
10. Run API + WebSocket streamingを実装する。
11. Playwright JSON保存とFailure Detailを実装する。
12. Allure integration spike用fixture projectを用意する。
13. AllureReportProviderを実装する。
14. Quality Gate実行・保存を実装する。
15. QMO summary v0を実装する。

## 36. Suggested File/Directory Structure

作成候補:

- `PLAN.md`: 本計画。
- `package.json`: workspace root。
- `pnpm-workspace.yaml`: workspace定義。
- `apps/web/`: React GUI。
- `apps/agent/`: Local Agent。
- `packages/shared/`: zod schemas/types。
- `packages/shared/src/domain/`: Project, Run, TestCase, Artifact, Report, AI, Patch schemas。
- `apps/agent/src/project/`: scanner、package manager detector。
- `apps/agent/src/commands/`: CommandRunner。
- `apps/agent/src/playwright/`: command builder、run manager。
- `apps/agent/src/reporting/`: ReportProvider、Allure provider。
- `apps/agent/src/git/`: git adapter。
- `apps/agent/src/ai/`: AI adapters。
- `apps/web/src/routes/`: TanStack Router。
- `apps/web/src/features/run-console/`
- `apps/web/src/features/failure-review/`
- `apps/web/src/features/diff-review/`
- `apps/web/src/features/qmo/`

## 37. Suggested Codex Implementation Prompts for Phase 1

Prompt 1:

「このリポジトリにpnpm workspaceを作成してください。`apps/web`, `apps/agent`, `packages/shared` の最小構成だけを追加し、Vite React、Hono (@hono/node-server)、TypeScript、zodを使える状態にしてください。まだPlaywright実行機能は作らず、health checkと型共有だけ確認してください。」

Prompt 2:

「`apps/agent` にProject scannerとPackageManagerDetectorを実装してください。project root、package.json、lockfile、playwright.config、spec候補を検出し、zod schemaで返すHTTP APIを追加してください。複数lockfile時はambiguousとしてテスト実行をブロックし、ユーザーに選択を必須としてください。暫定defaultによる自動決定はしないでください。」

Prompt 3:

「CommandRunner抽象とNodeCommandRunnerを実装してください。`node:child_process.spawn` をベースにし、shellを使わずcommand/args配列で実行し、stdout/stderr streaming、exit code、timeout、cancellation、allowed command policy、audit logを実装してください。execaは使わないでください。」

Prompt 4:

「Playwright command builderを実装してください。npm/pnpm/yarn/bunに応じてPlaywright test commandを組み立て、spec pathとtest-list選択をサポートしてください。実行結果はrun metadata、stdout.log、stderr.log、playwright-results.jsonへ保存してください。」

Prompt 5:

「FrontendにProject Open、Test Inventory、Run Console、Failure Detailの最小画面を実装してください。TanStack QueryでHTTP APIを読み、WebSocketでrun eventsを表示してください。」

## 38. Suggested Codex Implementation Prompts for Allure Report 3 Integration

Prompt 1:

「Allure Report 3 / allure-playwrightの最新公式docsとCLI helpを確認し、PoCで使うpackage名、CLI構文、設定方法、Quality Gate実行方法、`allure log` / `allure csv` 出力形式を短い調査メモにまとめてください。`allure agent` コマンドの存在と仕様も確認してください。コード変更はまだしないでください。」

Prompt 2:

「AllureReportProvider抽象を実装してください。runごとのallure-results、allure-report、history JSONL、quality-gate-result、CSV/log exportを読み、Workbench共通のReportSummaryへ正規化してください。」

Prompt 3:

「Playwright run pipelineにAllure output directory strategyを追加してください。Allure resultsをrun directoryに保存し、Allure HTML reportを生成し、report pathとURLをrun metadataに保存してください。既存Playwright configは自動変更しないでください。」

Prompt 4:

「Allure Quality Gate profileを実装してください。local-review、release-smoke、full-regressionのprofileをJSONで管理し、`allure quality-gate` のexit code/stdout/stderr/failed rulesを保存してGUIに表示してください。」

Prompt 5:

「QMO summary v0を実装してください。Playwright JSON、`allure log` / `allure csv` 出力、raw allure-results JSON、Quality Gate結果（exitCode + raw stdout/stderr）、history/flaky/known issueを読み、Workbench側でRelease Readiness SummaryをMarkdownとJSONで生成してください。`allure agent` コマンドには依存しないでください。」

## References Checked

- [Allure Report 3 Introduction](https://allurereport.org/docs/v3/)
- [Allure Report 3 Install](https://allurereport.org/docs/v3/install/)
- [Allure Report 3 Configure](https://allurereport.org/docs/v3/configure/)
- [Allure Quality Gate](https://allurereport.org/docs/quality-gate/)
- [Allure History Files](https://allurereport.org/docs/how-it-works-history-files/)
- [Allure CSV Export](https://allurereport.org/docs/export-csv/)
- [Allure Playwright](https://allurereport.org/docs/playwright/)
- [Allure Playwright Configuration](https://allurereport.org/docs/playwright-configuration/)
- [Playwright CLI](https://playwright.dev/docs/test-cli)
- [Playwright Reporters](https://playwright.dev/docs/test-reporters)
- [Playwright TestInfo.attach](https://playwright.dev/docs/api/class-testinfo)
- [Tauri Node.js Sidecar](https://v2.tauri.app/learn/sidecar-nodejs/)
- [Tauri Shell Plugin](https://v2.tauri.app/reference/javascript/shell/)
- [ReportPortal Documentation](https://reportportal.io/docs/)

## v2 改訂履歴 (2026-04-27)

v1 (PLAN.md) からの変更点:

1. **Storage名**: `.playwright-qa-workbench/` → `.playwright-workbench/` に統一。
2. **Agent framework**: Fastify → Hono + `ws` fallback。理由: Local AgentのAPI面が薄く、Tauri/Bun移行パスと相性が良い。WebSocketは `@hono/node-ws` 第一候補、問題時は `ws` 直使用へフォールバック。
3. **CommandRunner**: execa → `node:child_process.spawn` ベース。execa必須にしない。
4. **PackageManagerDetector**: 複数lockfile時の自動default決定を廃止。ambiguousとしてテスト実行をブロックし、ユーザーに選択を必須とする。
5. **Allure report保存**: 「最新report only」設計を廃止。run単位で `.playwright-workbench/runs/<runId>/allure-report/` に保存し、`latest-report/` は表示用便宜リンクのみ。
6. **allure agent 依存削除**: `allure agent` コマンドは公式docs未確認のため依存しない。AI/QMO向けsummaryは `allure log` / `allure csv` + raw allure-results JSON + Playwright JSONからWorkbench側で生成。
7. **Quality Gate**: stdout JSON parse前提を廃止。exitCode + stdout/stderr raw保存を基本とし、CLI help確認後にparse層追加。
8. **AST解析**: Phase 1では `playwright test --list` を権威ソースとし、ts-morphはPhase 5/7へ延期。`--list --reporter=json` は確定仕様として固定せず検証後に採用判断���
9. **Git patch安全策**: AI patch適用前の自動stashを廃止。dirty worktreeでパッチ対象ファイルに未コミット変更がある場合はブロック。将来的にtemporary worktreeで検証する方式を検討。
10. **配布モデル追加**: `npx playwright-workbench --project <path>` 型を基本。対象プロジェクトへの強制devDependency追加はしない。
11. **Monorepo簡素化**: PoC (Phase 1〜4) は `apps/web`, `apps/agent`, `packages/shared` のみ。その他のpackagesは境界が固まってから段階的に抽出。
12. **TanStack Form削除**: PoC Tech Stackから除外。
13. **Hono WSリスク追加**: §33 Risksに `@hono/node-ws` 安定性リスクとフォールバック戦略を追記。
