---
name: prepare-release
description: コミットと PR をレビュー向けに整える、もしくは feature を iterate した後の release-ready PR を準備するときに使う。pre-PR チェックリスト、commit 規約、PR 説明テンプレートを定義する。
---

# release-ready な commit と PR を準備する

> EN: [`SKILL.md`](SKILL.md) (英語版が SoT、本書は理解補助)

"release-ready" PR とは、最小限の cleanup で merge できる PR — CI が緑、規約が守られ、レビュアー (人間 / AI) が 1 pass で approve できる程度に説明が完備されたもの。

## いつ使うか

- T-task をまとめて PR を開く準備中。
- レビュー後に既存 PR を改訂し、cleanup の完了を確認したい。
- review を依頼する前に最終 pass をかけたい。

## Pre-commit チェックリスト

順に実行。最初の失敗で停止。

```bash
# 1. 型 drift
pnpm typecheck

# 2. テスト
pnpm test

# 3. (GUI を触ったなら) smoke
pnpm smoke:gui

# 4. (Allure pipeline を触ったなら) 全 E2E
pnpm smoke:gui:allure

# 5. diff レビュー
git diff main..HEAD --stat
```

そして:

- [ ] `PLAN.v2.md` または `IMPLEMENTATION_REPORT.md` を触ったか? もし yes なら **停止して revert**。代わりに PLAN.v3 / 新 RFC を使う。
- [ ] `.agents/rules/` または `.agents/skills/` の entry なしに新 convention を追加したか?
- [ ] `docs/operations/poc-guide.md` で文書化なしに新 env var を追加したか?
- [ ] 外部 surface に絶対パスを emit したか? `.agents/rules/path-safety-ja.md` 参照。
- [ ] `CommandRunner` を bypass する新 subprocess を導入したか? `.agents/rules/no-shell-ja.md` 参照。
- [ ] `packages/shared` 経由しない新境界型を追加したか? `.agents/rules/schema-first-ja.md` 参照。
- [ ] test が happy + 最低 1 つの failure mode をカバーしているか?

## Commit format

Conventional Commits、parens 内に T-task ID:

```
feat(T1500-3): add Stagehand exploration adapter

Implements Phase A of the multi-stage pipeline (RFC 0001 sec 4.1).

- apps/agent/src/exploration/stagehand.ts — adapter implementation
- packages/shared exploration schema — new ScreenModel + ExploredStep
- apps/agent/test/exploration.test.ts — happy path + 2 failure modes

Refs: docs/product/PLAN.v3.md sec 2.2 T1500-3
```

規約:
- subject ≤ 72 chars; 命令形。
- body は ~78 chars で wrap。hard wrap。
- body は **何が変わったか** (ファイル / 挙動) を列挙。なぜ (why) は PR 説明側。
- traceability のため `Refs:` 行。
- co-author 行は `~/.claude/settings.json` の global で disabled。user が再有効化しない限り追加しない。

## PR 説明テンプレート

```markdown
## Summary

<2-3 bullets: この PR が何をするか、user 観測の用語で>

## What's in this PR

- 領域別に整理された ファイル / コンポーネント / test 変更。

## Why this design

<根拠。代替案とのトレードオフ。該当時に RFC セクション参照。>

## NOT in this PR (intentional)

<scope を明示的に defer。reviewer の scope-creep 質問を防ぐ。>

## Test plan

- [ ] CI 緑 (verify + 該当時 gui smoke)
- [ ] <X> を <environment> で manual 確認
- [ ] (reviewer 自身に reproduce してほしいことを追記。)

## Refs

- PLAN.v3 sec X.Y (T-task 定義)
- RFC NNNN sec X (design spec)
- Prior PR #N (関連 context)
```

## Push と PR 作成

```bash
git push -u origin <branch>
gh pr create --base main --title "<commit subject>" --body "$(cat <<'EOF'
... PR description here ...
EOF
)"
```

user が auto-merge を使いたい場合:
- **意図する commit を全部先に push する。** auto-merge は CI が pass したら発火する; 後で commit を push しても squash に取り込まれない可能性。enable 後に `gh pr view <N> --json mergedAt` で確認。
- PR #88 の歴史にこの regression がある: commit 1 だけが squash され、commit 2 (license + brand) は失われ、PR #89 で recovery 必要。

## merge 前チェック

CI 緑 + reviewer approve 後:

- [ ] PR title が `main` に欲しい squash commit subject と一致しているか。
- [ ] レビュー中に scope が変わったら PR body も edit したか (scope drift を文書化なしにしない)。
- [ ] `WIP` / `Draft` マーカーが残っていないか。
- [ ] `gh pr view <N> --json mergeable,mergeStateStatus` が `MERGEABLE` を返すか。

## merge 後

```bash
gh pr merge <N> --squash --delete-branch
```

その後検証:

```bash
gh pr view <N> --json state,mergedAt,mergeCommit
```

squash された commit に後 commit が含まれていない場合、auto-merge race に当たっている。recovery は欠落 commit を新ブランチに cherry-pick する (PR #89 が canonical な fix の例)。

## 禁止事項

- `main` への `git push --force` (常に; 明示 user 承認なしには例外なし)。
- `main` への `git push --force-with-lease` (同上 — PR ブランチでのみ)。
- 必須 check を skip して red CI で merge する。
- merge 後に PR description を edit してレビュー対象を retcon する。
- 明示 user 承認なしに `gh pr merge --admin` で branch protection を bypass する。

## 関連

- `.agents/skills/execute-t-task/SKILL-ja.md` — release-ready PR を生む上流フロー。
- `.agents/skills/run-tests/SKILL-ja.md` — push 前に何を走らせるか。
- `.agents/rules/documentation-policy-ja.md` — どのファイルが edit 不可か。
