# T300: Phase 2 Failure Review Workbench enriched detail API + UI

## 目的

PLAN.v2 §31/§32 の Phase 2 成功条件「失敗testごとにstack、artifact、Allure履歴、known issue/flakyが確認できる」を満たす。

## スコープ

- 対象: run 単位の Failure Review 詳細 API、shared schema、FailureReview UI、関連テスト。
- 非対象: artifact file の配信 / inline preview、Allure HTML UI の再実装、known-issues の編集機能、AI 分析、repair proposal。これらは PLAN.v2 の後続 Phase。

## アプローチ

既存の `RunMetadata.summary.failedTests` を source of truth とし、agent 側で run-scoped `allure-results`、project-scoped `allure-history.jsonl`、`known-issues.json` を読み足して `FailureReviewResponse` に正規化する。UI は既存 `FailureReview` の stack / attachments 表示を保ち、per-test history / known issue / flaky signal を同じ row 内に追加する。Allure 固有形式は agent の reader に閉じ込め、frontend へは Workbench 共通 shape だけを返す。

## 検討した代替案

- 案A: UI で `/runs/:runId` と `/projects/:id/allure-history` を合成する / 不採用理由: known-issues と run-scoped Allure result の照合を frontend に漏らし、Allure 固有 key 依存が広がる。
- 案B: `FailedTestSchema` 自体へ history/known/flaky を追加する / 不採用理由: run metadata の永続形式が肥大化し、Phase 2 だけの review view に必要な派生情報を全 run record に持たせることになる。

## 影響範囲

- 変更ファイル: `packages/shared/src/index.ts`, `apps/agent/src/reporting/failureReview.ts`, `apps/agent/src/routes/runs.ts`, `apps/web/src/api/client.ts`, `apps/web/src/features/failure-review/FailureReview.tsx`, test files
- 既存機能への影響: `/runs/:runId` の既存 response は変更しない。FailureReview UI は新 endpoint を優先し、Phase 2 情報がない場合も既存の failedTests 表示を継続する。
- マイグレーション要否: なし。

## テスト方針

- agent: failure review derivation の unit test。Allure history / known issues の malformed or missing を warning として扱うことを確認。
- agent route: `GET /runs/:runId/failure-review` の 200 / no-summary / missing project を確認。
- web: FailureReview が history、known issue、flaky signal、attachments、stack を同時に描画することを確認。

## リスクと緩和策

- known-issues.json 形式が Allure CLI version で揺れる: 配列 / wrapper object / map 形式を best-effort normalize し、未認識は warning ではなく「一致なし」に倒す。
- history JSONL に per-test data がない: aggregate history は既存 card に任せ、FailureReview は per-test `testResults` がある行だけを表示する。ない場合は "No per-test history" と明示する。
- 絶対 path 漏えい: 新 API は既存 `FailedTest` の path 表示以上の path を追加しない。reader warning は basename/code 中心にする。

## セルフレビュー記録

- 要件: Phase 2 の stack / artifact / Allure history / known issue / flaky signal が同じ失敗 test row で確認できる。
- セキュリティ: 新 API は既存 run metadata と Workbench 管理下 artifacts の read のみ。任意 command 実行、path traversal、外部送信は追加しない。
- 運用: Allure side file 欠落や malformed known-issues は warning 化し、基本の failure review を表示し続ける。
- 検証: `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm smoke:gui` 合格。

## 想定外の判断ポイント

Allure history の `testResults` は PLAN では project-scoped JSONL としか定義されておらず、per-test key の安定性は保証されていない。Phase 2 では `historyId` / `testCaseId` / `fullName` / `name` / Playwright `testId` の順で best-effort 照合し、確実な保存形式の固定は後続 Phase の Allure provider 深掘りに残す。

## 失敗カウンタ

- phase_4_5_failure_count: 0
- pr_merge_failure_count: 0
