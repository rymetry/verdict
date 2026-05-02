---
name: verify-completion
description: T-task PR を「マージ可能」と判断する前に、自動チェック群を走らせる。CI 状態 / coverage / scope 規律 / schema-first 順序 / Conventional Commit 形式 / PR 説明の完備を検証し、項目別 pass/fail と総合 verdict を返す。Codex がハンドオフ完了して PR を作った直後、人間 / Codex レビュー依頼の前に使う。
---

# T-task PR の完了を verify する

> EN: [`SKILL.md`](SKILL.md) (英語版が SoT、本書は理解補助)

このスキルは「人間が diff を眺めて『良さそう』と言う」を決定論的なチェックリストに置き換える。PR を mutation せず、ドライバが action 可能な verdict を返す。

## 使い所

- ドライバが Codex のハンドオフから PR URL を受け取った直後
- Codex review を依頼する前 (基本チェックを通らない PR で Codex token を浪費しない)
- auto-merge 操作の前

## 入力

```
PR_NUMBER: <整数>
TID: <pick-next-task が返した T-id>
EXPECTED_SCOPE: <comma 区切りのパス prefix、省略可>
```

`EXPECTED_SCOPE` を省略した場合は PLAN.v3 行の "deliverable" 列から推定 (例: `T1500-3` → `apps/agent/src/exploration/`)。

## チェック項目 (全て走らせる、最初の失敗で止まらない)

### CHECK_CI — CI が green

```bash
gh pr view <PR_NUMBER> --json statusCheckRollup --jq '
  .statusCheckRollup[] |
  if .__typename == "StatusContext" then
    {
      name: .context,
      status: (if .state == "PENDING" or .state == "EXPECTED" then "IN_PROGRESS" else "COMPLETED" end),
      conclusion: (if .state == "SUCCESS" then "SUCCESS"
                   elif .state == "FAILURE" or .state == "ERROR" then "FAILURE"
                   else null end)
    }
  else
    {name: .name, status: .status, conclusion: .conclusion}
  end'
```

jq は `CheckRun` (GitHub Actions) と `StatusContext` (legacy commit status) の両方の形状を正規化してから rule を適用する — rollup は両方を混ぜて返すため。CheckRun は `status` / `conclusion`、StatusContext は `state` (`SUCCESS` / `FAILURE` / `ERROR` / `PENDING` / `EXPECTED`) のみ。正規化後:

- **WAITING**: `status != "COMPLETED"` (例: `IN_PROGRESS`, `QUEUED`, `PENDING`, `WAITING`) のエントリが 1 つでもあれば。後で再走、進めない
- **FAIL**: `conclusion` が `{FAILURE, CANCELLED, TIMED_OUT, ACTION_REQUIRED, STARTUP_FAILURE}` のいずれかのエントリが 1 つでもあれば
- **PASS**: 全エントリが `status == "COMPLETED"` かつ `conclusion` が `{SUCCESS, SKIPPED, NEUTRAL}` のいずれかであるとき

### CHECK_TID_IN_TITLE — PR title に T-id 含む

```bash
gh pr view <PR_NUMBER> --json title --jq '.title'
```

Title が `^(feat|fix|chore|refactor|docs|test|perf|ci|build|style)(\([^)]*<TID>[^)]*\))?: .+` にマッチすること。括弧内に T-id が含まれれば Pass。

### CHECK_COMMIT_FORMAT — Conventional Commits

```bash
gh pr view <PR_NUMBER> --json commits --jq '.commits[].messageHeadline'
```

各 commit の先頭行が Conventional Commits + ≤72 文字。squash merge 時には PR title が使われるが、コミット衛生は別途 surface。

### CHECK_SCOPE — diff が想定 scope 内に収まる

```bash
gh pr diff <PR_NUMBER> --name-only
```

各ファイルが `EXPECTED_SCOPE` の prefix のいずれか、もしくは普遍的に許容される scope (`packages/shared/src/**` の schema-first 追加、`apps/agent/test/**` と `apps/web/test/**` のテスト) に収まること。out-of-scope ファイルがあれば全部 list。1 つでもあれば Fail。

絶対 forbidden (触れていれば必ず Fail):
- `PLAN.v2.md`, `IMPLEMENTATION_REPORT.md`
- `LICENSE`
- `.github/workflows/**` (TID が CI 関連でない場合)
- `~/` 配下のあらゆるもの

### CHECK_SCHEMA_FIRST — schema-first 順序

diff が `apps/agent/src/routes/**` または `apps/agent/src/events/**` または `apps/web/src/api/**` を触っている場合:
- diff は `packages/shared/src/**` も触っていなければならない
- shared schema のコミット (または hunk) は consumer hunk より論理的に先 (multi-commit ならコミット順)。squash 後では強制不能だが、両方含む diff であることが test。

Pass: shared 変更あり。Fail: 「boundary code touched without packages/shared/ change」と diagnostic。

### CHECK_NO_SHELL — `child_process` 呼び出しなし

```bash
gh pr diff <PR_NUMBER> | grep -E '^\+.*(\bchild_process\b|\b(execSync|spawnSync|exec|spawn)[ \t]*[(])' || true
```

Pass: マッチなし。Fail: 各マッチ行を report。`^\+` で alternation 全体を追加行 (context や削除行ではない) に固定。第 1 の内側分岐 `\bchild_process\b` は `import { spawn as rawSpawn } from "node:child_process"` や `require("node:child_process")` のような module 参照を — エイリアス import であっても — キャッチ。第 2 の内側分岐 `\b(execSync|spawnSync|exec|spawn)[ \t]*[(]` は直接の呼び出し箇所を捕捉、`\b` 単語境界 + `[ \t]*[(]` (literal paren ではなく文字クラス) で `runtimeExec(` などの誤マッチを排除。CommandRunner 経由なら literal な `child_process` import は出ない。

### CHECK_PATH_SAFETY — 相対パスで emit

`apps/agent/src/routes/**`, `apps/agent/src/ai/**`, `apps/web/src/**` のファイルで:
- 戻り値やエラーメッセージ内の `path.resolve(`, `os.tmpdir(`, `process.cwd(`, `__dirname` を検索
- スタブ: heuristic なので auto-fail せず、人間レビューに flag。`WARN_PATH_SAFETY` を使う、`FAIL` ではない。

### CHECK_PR_BODY — 必須セクションが揃っている

```bash
gh pr view <PR_NUMBER> --json body --jq '.body'
```

body にこれらのヘッダが含まれること: `## Summary`, `## What's in this PR`, `## NOT in this PR`, `## Test plan`, `## Refs`。1 つでも欠ければ Fail。

### CHECK_COVERAGE_MENTION — coverage が body に記載

PR body に `coverage` (大小無視) と数値 80 以上、もしくは「coverage N/A — only doc/config」の明示的な justification が含まれること。どちらも無ければ Fail。

## 出力フォーマット

```
VERIFY: T1500-3 PR #92
================================
CHECK_CI                 : PASS
CHECK_TID_IN_TITLE       : PASS
CHECK_COMMIT_FORMAT      : PASS
CHECK_SCOPE              : PASS
CHECK_SCHEMA_FIRST       : PASS
CHECK_NO_SHELL           : PASS
CHECK_PATH_SAFETY        : WARN (1 件、notes 参照)
CHECK_PR_BODY            : PASS
CHECK_COVERAGE_MENTION   : PASS

VERDICT: PASS_WITH_WARNINGS
NOTES:
- CHECK_PATH_SAFETY: apps/agent/src/exploration/stagehand.ts:42 が path.resolve を使用;
  internal-only の可能性あり — 要レビュー。
```

Verdict 値:
- `PASS` — すべて PASS
- `PASS_WITH_WARNINGS` — WARN レベルのみ
- `FAIL` — 1 つでも FAIL
- `WAITING` — CI が in-progress、後で再 verify

## リトライ vs エスカレ

- `WAITING`: 60–120 秒ごとに再 poll (ドライバ責任)
- `FAIL` 連続: 同 TID の `failure_counts` を `checkpoint-progress` で increment。3 回で `escape-loop`。
- `PASS_WITH_WARNINGS`: ユーザに surface するが block しない。auto-merge は Codex review が gate。

## 禁止事項

- このスキルから PR をいじる (コメント / merge)。read-only。
- 「たぶん大丈夫だから」とチェックを飛ばす。
- SKIPPED な CI チェックを FAIL 扱いする (`dependabot-auto-merge` の SKIPPED は通常)。

## 関連

- [`.agents/skills/drive-next-task/SKILL-ja.md`](../drive-next-task/SKILL-ja.md) — Codex ハンドオフ後にこのスキルを呼ぶ。
- [`.agents/skills/escape-loop/SKILL-ja.md`](../escape-loop/SKILL-ja.md) — このスキルが 3 回 FAIL を返したときに発動。
- [`.agents/skills/prepare-release/SKILL-ja.md`](../prepare-release/SKILL-ja.md) — このスキルが機械化している人間側チェックリスト。
