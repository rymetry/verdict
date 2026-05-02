---
name: pick-next-task
description: PLAN.v3、main にマージ済みの commit 履歴、open PR を読んで、次に着手可能な unblocked な T-task を 1 件返す。すべての T-task が完了 / blocked のときは NONE を返す。自律ループ 1 iteration の入口、もしくはユーザーが「次は何を?」と T-task を指定せず聞いたときに使う。
---

# 次に着手する T-task を選ぶ

> EN: [`SKILL.md`](SKILL.md) (英語版が SoT、本書は理解補助)

このスキルは自律ループの起点。プロジェクト状態を読み取り、以下のいずれか 1 件だけを返す:
- 着手可能な T-task ブリーフ
- `STATUS: DONE` (in-scope の T-task が全て出荷済み)
- `STATUS: BLOCKED <理由>` (候補がすべて他作業に gated されている)

このスキルは mutation を一切行わない。読むだけ。

## 使い所

- 自律ループが新しい iteration を開始したとき
- ユーザが T-task ID を指定せずに「次は?」「何やる?」と聞いたとき
- T-task PR をマージした直後に「次」を決めたいとき

## 手順

### 1. PLAN.v3 §2.3 から scope を決定 (wave 構造)

Phase 1.5 wave map (変更があったら `docs/product/PLAN.v3.md` の §2.3 周辺を読み直す):

```
α (Foundation)  : T1500-1, T1500-2, T1500-8
β (Exploration) : T1500-3, T1500-4, T1500-5, T1500-6   # α 完了で解放
γ (UX)          : T1500-7, T1500-9                      # β 完了で解放
δ (Ecosystem)   : T1500-10                              # γ 完了で解放

Phase 2         : T2000-1..8                            # Phase 1.5 完了で解放
Phase 3         : T3000-1..10                           # Phase 2 完了で解放
```

同じ wave 内では、unblocked な中で最も小さい番号の T-task を優先。

### 2. 完了済み T-task を列挙

```bash
git fetch origin main
git log origin/main --oneline | grep -oE 'T[0-9]{4}-[0-9]+' | sort -u
```

これらは候補から除外。

### 3. 進行中 T-task を列挙 (open PR)

```bash
gh pr list --base main --state open --json number,title \
  --jq '.[] | select(.title | test("T[0-9]{4}-[0-9]+")) | {number, tid: (.title | capture("(?<tid>T[0-9]{4}-[0-9]+)").tid)}'
```

これらは "in-flight" 扱い。open PR を持つ T-task は再 pick 対象外。

### 4. アクティブ wave を判定

アクティブ wave = 未完了の T-task が残っている最も若い wave。現 wave のすべての T-task が main にマージされるまで、次の wave には進めない。

### 5. 候補を選ぶ

アクティブ wave 内で、以下を満たす最小番号の T-task を選ぶ:
- 完了済みリストに無い
- in-flight リストに無い
- 同 wave 内の前提依存 (PLAN.v3 §2.3 で明記されている場合) が満たされている

候補が 1 件も無ければ、その wave は完全に in-flight (PR マージ待ち) → `STATUS: BLOCKED waiting for in-flight PRs` を返す。

### 6. ブリーフを構築

PLAN.v3 §2.2 (Phase 1.5) / §3.2 (Phase 2) / §4.2 (Phase 3) の T-task 行を読み、出力:

```
TID: T1500-3
DELIVERABLE: Exploration Engine (Stagehand / Browser Use adapter) | apps/agent/src/exploration/ (新規)
PHASE: 1.5-β
WAVE: β (Exploration)
RFC_REF: docs/product/rfcs/0001-workbench-directory.md (行に参照があれば)
PLAN_REF: docs/product/PLAN.v3.md sec 2.2 T1500-3
DEPENDENCIES: T1500-1, T1500-2 (どちらも main マージ済み)
NOTES: <PLAN.v3 §2.3 の順序文に制約があれば記載>
```

行が曖昧な場合 (例: 存在しない RFC セクションを参照しているなど) は `AMBIGUITY: <説明>` を含めて、ドライバが escalate 判断できるようにする。

## 出力フォーマット

以下のいずれか:

```
TID: <T-id>
DELIVERABLE: <行テキスト>
PHASE: <1.5-α | 1.5-β | 1.5-γ | 1.5-δ | 2 | 3>
WAVE: <wave 文字 or phase>
RFC_REF: <パス or NONE>
PLAN_REF: <パス>
DEPENDENCIES: <comma 区切り T-id (すべて merged 確認済み)>
NOTES: <自由記述>
[AMBIGUITY: <テキスト>]
```

または:

```
STATUS: DONE
```

または:

```
STATUS: BLOCKED
REASON: <どの wave が in-flight か、待ちの PR 番号>
```

## 禁止事項

- PLAN.v3 に存在しない T-id を発明する。
- 前 wave が未完了なのに次 wave をスキップする。
- open PR がある T-task を picked 候補にする (重複を生む)。
- 複数候補を返す。自律ループは 1 iteration = 1 T-task が設計。

## 関連

- [`.agents/skills/drive-next-task/SKILL-ja.md`](../drive-next-task/SKILL-ja.md) — このスキルを呼ぶオーケストレータ。
- [`.agents/skills/checkpoint-progress/SKILL-ja.md`](../checkpoint-progress/SKILL-ja.md) — picked T-id を iteration 間で永続化。
- [`.agents/skills/execute-t-task/SKILL-ja.md`](../execute-t-task/SKILL-ja.md) — pick 後に Codex が走らせる実装フロー。
