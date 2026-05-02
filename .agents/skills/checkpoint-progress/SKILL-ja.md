---
name: checkpoint-progress
description: 自律ループの進捗状態を `.agents/state/progress.json` で読み書きする。アクティブな T-task / 現 PR / 完了済みリスト / TID ごとの失敗回数 / エスカレ flag を保持する。中断されたループの再開、iteration 間の進捗更新、ループの達成状況確認に使う。
---

# 自律ループ進捗状態の管理

> EN: [`SKILL.md`](SKILL.md) (英語版が SoT、本書は理解補助)

このスキルは自律ループの永続化レイヤ。状態は `.agents/state/progress.json` に保存され、**gitignore** されている (per-machine、per-session)。

## 状態スキーマ

```json
{
  "schema_version": 1,
  "started_at": "2026-05-02T13:45:00Z",
  "last_iter_at": "2026-05-02T15:12:00Z",
  "active": {
    "tid": "T1500-3",
    "pr_number": 94,
    "branch": "feat/T1500-3-exploration",
    "started_at": "2026-05-02T15:00:00Z",
    "last_codex_attempt_at": "2026-05-02T15:08:00Z"
  },
  "completed": ["T1500-1", "T1500-2"],
  "failure_counts": {
    "T1500-3": 1
  },
  "escalated": [],
  "stats": {
    "iterations": 4,
    "codex_calls": 6,
    "ci_polls": 12
  }
}
```

`active` は task 間で `null`。`completed` は append-only。

## 操作

### init — 初回セットアップ

`.agents/state/progress.json` が存在しない場合:

```bash
mkdir -p .agents/state
cat > .agents/state/progress.json <<'EOF'
{
  "schema_version": 1,
  "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "last_iter_at": null,
  "active": null,
  "completed": [],
  "failure_counts": {},
  "escalated": [],
  "stats": {"iterations": 0, "codex_calls": 0, "ci_polls": 0}
}
EOF
```

### read — 現状取得

```bash
jq '.' .agents/state/progress.json
```

### claim_task — T-task を active としてマーク

```bash
TID=<T-id>
BRANCH=<branch>
jq --arg tid "$TID" --arg branch "$BRANCH" --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  .active = {
    tid: $tid,
    pr_number: null,
    branch: $branch,
    started_at: $now,
    last_codex_attempt_at: $now
  } |
  .last_iter_at = $now |
  .stats.iterations += 1
' .agents/state/progress.json > .agents/state/progress.tmp.json && \
  mv .agents/state/progress.tmp.json .agents/state/progress.json
```

### record_pr — PR 番号を attach

```bash
PR=<n>
jq --argjson pr "$PR" '.active.pr_number = $pr' \
  .agents/state/progress.json > .agents/state/progress.tmp.json && \
  mv .agents/state/progress.tmp.json .agents/state/progress.json
```

### record_failure — 失敗回数を increment

```bash
TID=<T-id>
jq --arg tid "$TID" '.failure_counts[$tid] = ((.failure_counts[$tid] // 0) + 1)' \
  .agents/state/progress.json > .agents/state/progress.tmp.json && \
  mv .agents/state/progress.tmp.json .agents/state/progress.json
```

### complete_task — active T-task をマージ済みとしてマーク

```bash
TID=<T-id>
jq --arg tid "$TID" --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  .completed = (.completed + [$tid] | unique) |
  .failure_counts[$tid] = 0 |
  .active = null |
  .last_iter_at = $now
' .agents/state/progress.json > .agents/state/progress.tmp.json && \
  mv .agents/state/progress.tmp.json .agents/state/progress.json
```

### record_codex_call / record_ci_poll — 統計

```bash
jq '.stats.codex_calls += 1' .agents/state/progress.json > .agents/state/progress.tmp.json && \
  mv .agents/state/progress.tmp.json .agents/state/progress.json
# ci_polls も同様
```

### resume_check — ループは新 iteration を始めるべきか?

```bash
jq '
  if .escalated | length > 0 then "BLOCKED_ESCALATED"
  elif .active != null then "RESUME_ACTIVE"
  else "READY_FOR_NEXT"
  end
' .agents/state/progress.json
```

ドライバは結果で分岐:
- `BLOCKED_ESCALATED` — ループが停止中、ユーザ介入を要求
- `RESUME_ACTIVE` — 未完了タスクあり、新 pick 前に PR 状態を確認
- `READY_FOR_NEXT` — pick-next-task して fresh start

## 禁止事項

- ループ中に `progress.json` を手で編集する。上記の操作を使う。
- `completed` エントリを削除する。append-only; revert で巻き戻ったら新 sub-task を PLAN.v3 に追加する。
- `progress.json` に secrets / token / パスを保存する。state は debug 可読。
- `progress.json` を git に commit する。gitignore のままに。

## 確認方法

```bash
# 何が in-flight?
jq '.active' .agents/state/progress.json

# T-task 完了数?
jq '.completed | length' .agents/state/progress.json

# escalate されたものあり?
jq '.escalated' .agents/state/progress.json
```

## 関連

- [`.agents/skills/drive-next-task/SKILL-ja.md`](../drive-next-task/SKILL-ja.md) — この state を routine 的に書く唯一のスキル。
- [`.agents/skills/escape-loop/SKILL-ja.md`](../escape-loop/SKILL-ja.md) — `escalated` に追記する。
- `.gitignore` — `.agents/state/` を除外。
