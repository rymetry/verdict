# Phase 1.5 Warning Observability

Issue #23 は Phase 1 foundation harden の follow-up として、run warning の到達性と silent failure 経路の観測性を補う。

## Warning delivery

Run warning は次の経路すべてで確認できるようにする。

- `RunMetadata.warnings`: run の永続的な source of truth。
- WebSocket terminal event: `run.completed` / `run.cancelled` / `run.error` は最終 warning を payload に含める。
- HTTP API: `GET /runs/:runId` は完全な metadata、`GET /runs` は list item の warning summary を返す。
- Web UI: `RunConsole` は live WS warning、`FailureReview` は persisted warning を表示する。

## Message responsibility

UI/API 向け warning は、ユーザーが判断できる安定した文言と error code のみにする。raw `error.message`、内部絶対パス、stack trace、secret 候補は表示しない。

運用者向けの詳細は構造化ログに残す。例として、log write failure は UI では `stdout log write failed; ... code=ENOSPC` に留め、構造化ログには `runId`、`stream`、`artifactKind`、`code`、詳細 error を記録する。

Run 起動前の HTTP error code は原因分類できる粒度に分ける。command build failure、policy rejection、audit persistence failure、unknown startup failure は別 code にし、message は固定の安全な文言に限定する。

Log write failure が同一 stream で複数回起きた場合、UI warning は最初の code、distinct code list、failure count を表示する。構造化ログは stream ごとの最初の failure を詳細付きで残し、後続 code の存在は warning の `codes=` で追跡する。

Phase 1.7 (Issue #27 / PR #28) で構造化ログの payload schema が変わった。`playwrightJsonPath` / `projectRoot` / `err: error.message` フィールドは廃止し、`artifactKind` (closed `ArtifactKind` union) + `errorName` + `code` の組で識別する形に固定。ログ集約系で旧フィールドを参照していた query は `artifactKind` ベースに置換が必要。`errorLogFields(error)` helper が fail-closed で `error.message` を drop するため、絶対パスがメッセージ経由で漏れる経路を構造的に塞ぐ。

Phase 1.2 prep (Issue #31) で構造化ログの payload schema を再度変更した。`ArtifactKind` を **identity 軸のみ** に縮小し、新たに `ArtifactOperation` (closed union) を `op?` フィールドとして追加した。具体的な変更:

- `playwright-json-redaction` → `{ artifactKind: "playwright-json", op: "redaction" }`
- `playwright-json-summary` → `{ artifactKind: "playwright-json", op: "summary-extract" }`
- `stream-redaction` (with `stream` field) → `{ artifactKind: "stdout-log" | "stderr-log", op: "stream-redaction" }` (補助 `stream` field は廃止し identity に統合)
- `html-report` → `playwright-html` (rename。Phase 1.2 で `allure-report` (Allure HTML) と並んで複数 reporter の HTML を区別できるよう identity 名規則を統一)

ログ集約系で旧 `artifactKind` 値を参照していた query は新 `{ artifactKind, op }` 2-axis に置換が必要。Phase 1.2 で `allure-results` / `allure-report` / `allure-exports` identity を追加する際は identity 軸の追加のみで済み、operation 軸との掛け合わせで union が `O(reporter × operation)` に膨張する事故を防ぐ。

## Audit mode

Audit log 永続化は既定では fail-open とする。ローカル開発環境で `.playwright-workbench/audit.log` の権限問題が発生しても、Playwright run 自体を止めないため。

運用上 audit 欠落を許容できない場合は `AGENT_FAIL_CLOSED_AUDIT=1` を設定する。この場合、audit persistence failure は command spawn 前に fail-closed し、run を開始しない。

Phase 1.6 (Issue #25) では、test hook 等の audit observer failure と audit persistence failure を分離する。observer は診断・テスト用途の副作用であり、throw しても run を止めない。`AGENT_FAIL_CLOSED_AUDIT=1` が fail-closed にする対象は `.playwright-workbench/audit.log` への永続化失敗のみとする。

Boolean env flag は `1` / `true` / `0` / `false` / 空 / 未指定だけを受け付ける。`yes` / `on` などの曖昧値は startup validation error にする。特に `WORKBENCH_ALLOW_REMOTE` は bind scope に関わるため、意図しない remote bind を避ける目的で truthy 値を拡張しない。

## Redaction scope

Phase 1.5 の redaction は stdout/stderr stream、audit args、Playwright JSON reporter output を対象にする。HTML report、trace、video、screenshot、追加 reporter artifact の内容 redaction は将来の artifact policy で扱う。

Redaction failure 時は raw Playwright JSON を best-effort で削除し、削除失敗時は metadata warning に「raw artifact が残っている可能性」を記録する。

Phase 1.6 では redaction 成功時も構造化ログへ `runId`、`artifactKind`、置換件数を残す。ログには raw chunk、secret 候補、内部絶対パスを含めない。

> **対応スコープの最新表は [`phase-1-7-artifact-redaction-scope.md`](./phase-1-7-artifact-redaction-scope.md) を参照** (Phase 1.7 / Issue #27 項目 5 で ADR 化)。本 doc は warning observability 全体の方針を扱い、redaction の対応スコープ表は Phase 1.7 doc を Single Source of Truth とする。

## Event contract hardening

Phase 1.6 (Issue #25) では、run event と snapshot event の envelope を分離し、`run.*` event は `runId` を必須にする。`snapshot` は run に属さないため `runId` を持たない。

`run.cancelled` は `cancelReason` を任意で持つ。値は `user-request` / `internal` の closed enum に限定し、UI は enum から固定ラベルを表示する。raw cancel reason、stderr、例外 message は UI/API に出さない。

Timeout は `run.cancelled` に分類しない。既存 semantics どおり `run.error` とし、timeout warning を metadata / terminal event / UI へ届ける。Timeout を cancelled にすると、ユーザー操作による cancel と異常終了の区別が曖昧になるため採用しない。

## Rejected alternatives

- Audit persistence failure を既定で fail-closed にする案は採用しない。ローカル run を環境依存の権限問題で止める副作用が大きいため、規制や監査要件がある環境だけ `AGENT_FAIL_CLOSED_AUDIT=1` で opt-in する。
- UI/API に raw `error.message` を返す案は採用しない。`cwd`、realpath、secret 候補が混入し得るため、UI/API は安定した error code と安全な文言だけを扱い、詳細は構造化ログへ分離する。
- `run.completed` / `run.cancelled` / `run.error` を単一 schema から派生させる案は採用しない。terminal event ごとに許容 status と payload の意味が異なるため、schema を分けて illegal state を表現できない形にする。
- Timeout を `run.cancelled` として扱う案は採用しない。timeout は explicit user cancel ではなく、運用上は error-state termination として調査対象にすべきため。
