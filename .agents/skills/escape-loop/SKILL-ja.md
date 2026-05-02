---
name: escape-loop
description: 自律ループが同じ T-task で詰まっているのを検知し、診断ダンプ付きでユーザにエスカレーションする。verify-completion が同 TID で連続 3 回 FAIL を返したとき、または同じ Codex ハンドオフが merged PR 無しで 3 回リトライされたときに発火。失敗パターンを surface し、ループを停止する。
---

# 詰まった自律ループから escape する

> EN: [`SKILL.md`](SKILL.md) (英語版が SoT、本書は理解補助)

このスキルは安全弁。これが無いと自律ループは同じ壊れたタスクを無限にリトライして token と時間を燃やす。

## 使い所

- `checkpoint-progress` が `failure_counts[<TID>] >= 3` を report
- 同一 PR を 30 分以内に 3 回以上 push し直しても verify-completion が pass しない
- Codex `exec` が同じハンドオフで 3 回 crash / timeout
- ドライバが「直近の失敗メッセージ 3 回が同一」を string-match で検知

## 手順

### 1. トリガを確認

`.agents/state/progress.json` を読み、`failure_counts[<TID>]` がトリガ源であることを確認。3 未満なら何もしない (誤発火)。

### 2. 診断ダンプを集める

失敗中の T-task について:

```bash
TID=<T-id>
PR=<checkpoint の PR_NUMBER、あれば>

# 直近 3 回の試行: commit / CI 結果 / verify 出力
{
  echo "## TID: $TID"
  echo "## Failure count: 3"
  echo
  echo "### 直近 3 回の verify-completion 出力"
  cat .agents/state/last-verify-1.log
  cat .agents/state/last-verify-2.log
  cat .agents/state/last-verify-3.log
  echo
  echo "### Open PR"
  gh pr view $PR --json title,statusCheckRollup,commits 2>/dev/null
  echo
  echo "### ブランチ末尾 3 commit"
  gh pr view $PR --json commits --jq '.commits | .[-3:] | .[].messageHeadline' 2>/dev/null
} > .agents/state/escape-dump-$TID.md
```

### 3. 失敗パターンを分類

ダンプを以下のクラスに照合 (verify 出力の string-match):

- `RECURRING_CI_FAILURE` — 同じ CI チェックが 3 回連続失敗。エスカレ: どの job か、log への link を提示
- `RECURRING_TYPE_ERROR` — `Cannot find` / `Type ... is not assignable` 系が連続。エスカレ: `pnpm --filter @pwqa/shared build` を忘れた可能性 or 本物の type error
- `RECURRING_SCOPE_VIOLATION` — verify の `CHECK_SCOPE` が連続 fail。エスカレ: T-task scope が hand-off で誤判定された。prompt の書き直しが必要
- `CODEX_HANG` — Codex exec が出力なしで終了。エスカレ: model / sandbox / network 系の問題、明日リトライ
- `UNCLASSIFIED` — どれにも当たらず。エスカレ: 汎用

### 4. ループを停止

```bash
# T-task を escalated 状態としてマーク; auto-retry しない
jq '.escalated = (.escalated // []) + [{"tid": "'$TID'", "at": now, "class": "<step 3 結果>"}]' \
  .agents/state/progress.json > .agents/state/progress.tmp.json && \
  mv .agents/state/progress.tmp.json .agents/state/progress.json
```

### 5. ユーザに surface

stdout / Claude 会話に出力:

```
🛑 自律ループ ESCALATED

TID: <T-id>
Class: <RECURRING_CI_FAILURE | RECURRING_TYPE_ERROR | RECURRING_SCOPE_VIOLATION | CODEX_HANG | UNCLASSIFIED>
Failure count: 3
Open PR: #<n>

診断ダンプ: .agents/state/escape-dump-<TID>.md

推奨次アクション:
<クラスごとの 1 行具体的な推奨>

自律ループは一時停止しました。再開コマンド:
  rm .agents/state/escape-dump-<TID>.md
  jq '.escalated = [.escalated[] | select(.tid != "<TID>")] | .failure_counts."<TID>" = 0' \
    .agents/state/progress.json > .agents/state/progress.tmp.json && \
    mv .agents/state/progress.tmp.json .agents/state/progress.json
```

## 禁止事項

- 件数 3 未満で発火 (「早めに bail しよう」)。閾値は契約の一部。
- 失敗 T-task を編集して auto-fix する。エスカレ時刻のループは read-only が原則。
- 診断ダンプを省略する。ダンプはユーザのデバッグ context。
- エスカレ後に次 T-task に進む。ループ全体を停止し、ユーザが明示的に再開する。

## 再開契約

ユーザは以下で再開:
1. 診断ダンプを読む
2. 根本原因を修正 (ハンドオフ prompt 書き直し / test 修正など) または T-task を PLAN.v3 で deferred マーク
3. `.agents/state/progress.json` の `failure_counts[<TID>]` と `escalated[]` をリセット
4. ドライバを再起動

スキル自体は auto-resume しない。エスカレには人間の確認が必須。

## 関連

- [`.agents/skills/drive-next-task/SKILL-ja.md`](../drive-next-task/SKILL-ja.md) — このスキルの停止シグナルを check する。
- [`.agents/skills/checkpoint-progress/SKILL-ja.md`](../checkpoint-progress/SKILL-ja.md) — `failure_counts` と `escalated` フィールドを所有。
- [`.agents/skills/verify-completion/SKILL-ja.md`](../verify-completion/SKILL-ja.md) — 失敗源。
