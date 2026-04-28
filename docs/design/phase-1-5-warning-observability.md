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

## Audit mode

Audit log 永続化は既定では fail-open とする。ローカル開発環境で `.playwright-workbench/audit.log` の権限問題が発生しても、Playwright run 自体を止めないため。

運用上 audit 欠落を許容できない場合は `AGENT_FAIL_CLOSED_AUDIT=1` を設定する。この場合、audit persistence failure は command spawn 前に fail-closed し、run を開始しない。

## Redaction scope

Phase 1.5 の redaction は stdout/stderr stream、audit args、Playwright JSON reporter output を対象にする。HTML report、trace、video、screenshot、追加 reporter artifact の内容 redaction は将来の artifact policy で扱う。

Redaction failure 時は raw Playwright JSON を best-effort で削除し、削除失敗時は metadata warning に「raw artifact が残っている可能性」を記録する。

## Rejected alternatives

- Audit persistence failure を既定で fail-closed にする案は採用しない。ローカル run を環境依存の権限問題で止める副作用が大きいため、規制や監査要件がある環境だけ `AGENT_FAIL_CLOSED_AUDIT=1` で opt-in する。
- UI/API に raw `error.message` を返す案は採用しない。`cwd`、realpath、secret 候補が混入し得るため、UI/API は安定した error code と安全な文言だけを扱い、詳細は構造化ログへ分離する。
- `run.completed` / `run.cancelled` / `run.error` を単一 schema から派生させる案は採用しない。terminal event ごとに許容 status と payload の意味が異なるため、schema を分けて illegal state を表現できない形にする。
