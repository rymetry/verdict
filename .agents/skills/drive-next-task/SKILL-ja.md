---
name: drive-next-task
description: 自律ループを 1 iteration 回す。進捗 checkpoint を読み、次 T-task を選び、Codex にハンドオフし、PR を待ち、verify-completion を走らせ、Codex review を依頼し、optional に auto-merge し、checkpoint を更新して次か exit する。PLAN.v3 を 1 task ずつユーザに promp すること無しに進めるためのスキル。ドライバは read-write — branch 修正、PR open、(`AUTONOMY_AUTO_MERGE=true` 時) merge を行う。
---

# 自律ループ 1 iteration を回す

> EN: [`SKILL.md`](SKILL.md) (英語版が SoT、本書は理解補助)

これがオーケストレータ。`pick-next-task` / `execute-t-task` (Codex 経由) / `verify-completion` / `escape-loop` / `checkpoint-progress` を組み合わせる。

## モード

- **デフォルト (semi-autonomous)**: verify-completion が pass するまで自律で進めるが、merge 前で停止し PR を人間承認に surface
- **Full-autonomy** (`AUTONOMY_AUTO_MERGE=true`): merge までも自律。ユーザが明示 opt-in した場合のみ使う

## Pre-flight

1. `node_modules` が bootstrap 済みか確認 (`AGENTS.md` §4 callout)
2. `.agents/state/progress.json` が存在するか確認、無ければ `checkpoint-progress` の init を実行
3. working tree が clean (`git status --short` が空) であることを確認

pre-flight のいずれかが失敗 → ユーザにエスカレ; 進めない。

## 手順 (1 iteration)

### Step 1 — checkpoint resume_check

```bash
RESUME=$(jq -r '
  if .escalated | length > 0 then "BLOCKED_ESCALATED"
  elif .active != null then "RESUME_ACTIVE"
  else "READY_FOR_NEXT"
  end
' .agents/state/progress.json)
```

- `BLOCKED_ESCALATED` → exit。「ループ停止中、escape ダンプ参照」を surface
- `RESUME_ACTIVE` → アクティブ PR が既にマージ済みかを `gh pr view <pr_number> --json state --jq .state` で確認。`MERGED` なら `checkpoint-progress complete_task` を呼び、この iteration を `READY_FOR_NEXT` 扱いにして Step 2 に進む (次 T-task を pick)。それ以外は Step 4 に進む (既存 PR を再 verify; 新 task は pick しない)
- `READY_FOR_NEXT` → Step 2 へ

### Step 2 — task を pick

`pick-next-task` を invoke。結果ごと:
- `STATUS: DONE` → exit。PLAN.v3 完走
- `STATUS: BLOCKED <理由>` → 10 分待って Step 2 を再実行 (PR が CI 中の可能性大)
- `TID: <T-id> ...` → Step 3 へ

`checkpoint-progress claim_task` を TID と派生 branch 名 (`<type>/<TID>-<short-kebab>` per `prepare-release`) で呼ぶ。

### Step 3 — Codex にハンドオフ

過去のハンドオフ (例: PR #92) からテンプレして Codex prompt を作る。テンプレ内訳:
- `pick-next-task` 出力から `{TID}`, `{DELIVERABLE}`
- 必読リスト (AGENTS.md, execute-t-task, schema-first, path-safety, no-shell, secret-handling, run-tests; 行に RFC があればそれも)
- deliverable 列から導出した in-scope / not-in-scope セクション
- branch / commit / PR の規約
- pre-PR checklist (AGENTS.md §4 bootstrap → schema build → typecheck → test → coverage)

prompt を `.agents/state/codex-prompt-<TID>.md` に保存 (task 完了までデバッグ用に保持) し:

```bash
codex exec \
  -c 'model="gpt-5.5"' \
  -c 'model_reasoning_effort="high"' \
  --cd "$(pwd)" \
  "$(cat .agents/state/codex-prompt-<TID>.md)" \
  > .agents/state/codex-out-<TID>.log 2>&1
```

invoke 後に `record_codex_call`。

`codex exec` が non-zero 終了したら `record_failure` で increment して Step 6 へ。

Codex は PR を作るはず。出力 log から regex `https://github\.com/[^/]+/[^/]+/pull/(\d+)` で PR 番号抽出 → `record_pr`。

### Step 4 — PR を verify

`verify-completion` を PR 番号と TID で invoke。

結果ごと:
- `WAITING` → 90 秒待って verify を再走 (`record_ci_poll`)
- `FAIL` → `record_failure` し Step 6 へ
- `PASS_WITH_WARNINGS` → warning を log; Step 5 に進む (warning は advisory)
- `PASS` → Step 5 へ

### Step 5 — Codex review

```bash
codex review --commit "$(gh pr view <PR_NUMBER> --json commits --jq '.commits[-1].oid')" \
  -c 'model="gpt-5.5"' -c 'model_reasoning_effort="high"' \
  --title "$(gh pr view <PR_NUMBER> --json title --jq '.title')" \
  > .agents/state/codex-review-<TID>.log 2>&1
```

Review が P0/P1 を出した場合:
- 記録のため PR にコメントを投稿
- 元の T-task scope 内の指摘 → fix prompt として Codex に再ハンドオフ (Step 3 variant)。同じ問題が複数試行で残ったときだけ `failure_counts` を increment
- scope-creep 系 (T-task 拡張) → follow-up に defer; リトライしない。verify を PASS-with-deferred-followup として扱う

review が clean → Step 6 (success) へ

### Step 6 — iteration を finalize

2 経路:

**6a. 失敗経路** (verify FAIL or codex exec 失敗):
- `failure_counts[<TID>]` を check。`>= 3` → `escape-loop` invoke して exit
- それ以外: `active` を維持; 次 iteration が同 TID でリトライ

**6b. 成功経路** (verify PASS, review clean):
- 記録のため PR に「verify-completion: PASS, codex review: clean」とコメント
- `AUTONOMY_AUTO_MERGE=true` なら:
  ```bash
  gh pr merge <PR_NUMBER> --squash --delete-branch
  ```
  続いて `complete_task` し、Step 1 で次 iteration へ
- それ以外 (デフォルト): "READY_FOR_HUMAN_MERGE" を PR URL と共に emit して exit。次 iteration は Step 1 で `RESUME_ACTIVE` を検知 → PR 状態を確認 → merged なら `complete_task` して進む

## 出力 (iteration ごと)

ドライバは常に構造化 summary を出す:

```
ITERATION: <n>
TID: <T-id>
PR: #<n> (<URL>)
VERIFY: PASS | PASS_WITH_WARNINGS | FAIL | WAITING
CODEX_REVIEW: clean | issues:<count> | n/a
RESULT: READY_FOR_HUMAN_MERGE | MERGED | RETRYING | ESCALATED | BLOCKED_DONE
NEXT: <次 iteration が何をするか、または DONE>
```

## 禁止事項

- `AUTONOMY_AUTO_MERGE=true` 設定無しの auto-merge
- verify-completion を skip (「CI green で十分」)
- ユーザ resume 無しに escape-loop を素通り
- 1 iteration で複数 T-task を pick
- `~/.codex/auth.json` その他の secrets ファイルへの touch

## 初回サンプル

```bash
# auto-merge を明示 opt-in (省略でも semi-autonomous モードは動く):
export AUTONOMY_AUTO_MERGE=false

# state を初期化:
mkdir -p .agents/state
[ -f .agents/state/progress.json ] || \
  echo '{"schema_version":1,"started_at":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","active":null,"completed":[],"failure_counts":{},"escalated":[],"stats":{"iterations":0,"codex_calls":0,"ci_polls":0},"last_iter_at":null}' \
  > .agents/state/progress.json

# 1 iteration を手動実行 (Claude セッション内で):
#   "Run drive-next-task"
# あるいは /loop / /schedule で定期実行をセット
```

## 関連

- [`.agents/skills/pick-next-task/SKILL-ja.md`](../pick-next-task/SKILL-ja.md) — Step 2
- [`.agents/skills/checkpoint-progress/SKILL-ja.md`](../checkpoint-progress/SKILL-ja.md) — state mutation
- [`.agents/skills/verify-completion/SKILL-ja.md`](../verify-completion/SKILL-ja.md) — Step 4
- [`.agents/skills/escape-loop/SKILL-ja.md`](../escape-loop/SKILL-ja.md) — Step 6a の trigger
- [`.agents/skills/execute-t-task/SKILL-ja.md`](../execute-t-task/SKILL-ja.md) — Step 3 で Codex が follow するスキル
- [`AGENTS.md`](../../../AGENTS.md) §4 — pre-flight が enforce する bootstrap 要件
