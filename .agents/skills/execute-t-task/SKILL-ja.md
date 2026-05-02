---
name: execute-t-task
description: PLAN.v3 の番号付き T-task (例: T1500-3, T2000-5) を起点に作業するときに使う。1 PR が 1 T-task になるよう、標準的なブランチ・コミット・テスト・PR 進行を確立する。
---

# PLAN.v3 の T-task を実行する

> EN: [`SKILL.md`](SKILL.md) (英語版が SoT、本書は理解補助)

T-task は Verdict の PR scope の単位。1 PR は 1 T-task に対応し、task ID をブランチ・commit・PR タイトルで露出する。

## いつ使うか

- ユーザーが "T1500-3" や "T2000-5" のような T-ID に言及したとき。
- PLAN.v3.md の §2-§4 の deliverable に対応する作業を始めるとき。
- レビュアー (人間 + AI) が 1 つの論理変更を評価できるよう PR を綺麗に scope したいとき。

PLAN.v3 に **無い** task の場合、停止して user に確認する: PLAN.v3 に先に追加するか、それとも単発の `chore:` / `fix:` PR として進めるか?

## 標準フロー

### 1. PLAN.v3 で T-task を locate

```bash
grep -n "T1500-3" docs/product/PLAN.v3.md
```

該当行を読んで:
- deliverable (どのファイルパス / どの挙動か)。
- phase ordering — 前 task に依存しているか?
- 行から参照される RFC や skill。

deliverable が RFC を参照している場合 (例: `docs/product/rfcs/0001-*`)、コードを書く前にその関連セクションを読む。

### 2. ブランチ作成

```bash
git fetch origin main
git checkout -b feat/T1500-3-exploration-engine origin/main
```

ブランチ規約: `<type>/<T-id>-<short-kebab-name>`。type は Conventional Commits 準拠。

### 3. 変更計画

コードを触る前に 5-10 分かけて書面で計画する:

- 作成 / 変更するファイル。
- `packages/shared` の schema 変更 (これらは **最初** — `.agents/rules/schema-first-ja.md` 参照)。
- 追加する test (vitest unit + integration; user-visible なら e2e)。
- 変更が trigger する hook (typecheck、post-write)。

3 step 以上ある場合は `TaskCreate` で sub-step を track。完了するごとに mark する。

### 4. Schema-first で実装

完全な手順は `.agents/skills/add-shared-schema/SKILL-ja.md`。要約:

1. `packages/shared/src/index.ts` に新 Zod schema を追加。
2. `pnpm --filter @pwqa/shared build` で consumer が新型を見えるようにする。
3. 新 schema を import する agent / web 変更を実装。

### 5. 実装 + テストを lockstep で

- test コマンドは `.agents/skills/run-tests/SKILL-ja.md` 参照。
- 可能なら TDD (ユーザーグローバル rule: test を先に書き、fail を確認、その後実装)。
- 実質的な変更ごとに `pnpm typecheck` を走らせる。早期 catch の型 drift は安価。
- agent コードでは failure path (timed out、cancelled、exit-non-zero) を明示的に exercise する。

### 6. PR 前 self check

- [ ] 新 API は `packages/shared` の zod schema を経由しているか?
- [ ] path 出力コードは project-relative を出すか? `.agents/rules/path-safety-ja.md` 参照。
- [ ] subprocess コードは `CommandRunner` を使っているか? `.agents/rules/no-shell-ja.md` 参照。
- [ ] 生 secret を log していないか? `.agents/rules/secret-handling-ja.md` 参照。
- [ ] test が新挙動 + failure mode をカバーしているか?
- [ ] ローカルで `pnpm typecheck && pnpm test` が緑か?
- [ ] PLAN.v2.md / IMPLEMENTATION_REPORT.md を edit していないか?

### 7. Commit

```
git commit -m "feat(T1500-3): add exploration engine adapter for Stagehand

Implements the Stagehand-backed Phase A of the multi-stage AI pipeline
(see RFC 0001 sec 4.1). Adds:
  - apps/agent/src/exploration/stagehand.ts
  - packages/shared exploration schema
  - integration test against the sample Allure fixture

Refs: docs/product/PLAN.v3.md sec 2.2 T1500-3"
```

subject ≤72 chars、body ~78 で wrap。subject 括弧内 + body で T-ID を参照。`Refs:` 行で PLAN.v3 にトレース。

### 8. PR を作る

```
gh pr create --base main \
  --title "feat(T1500-3): add Stagehand exploration adapter" \
  --body "$(...)"
```

標準 PR body テンプレートを使う (前 PR #88/#89 が形の参考):

- **Summary** — 2-3 bullets、何 + なぜ。
- **What's in this PR** — ファイル / コンポーネント / test の変更箇所。
- **Why this design** — 根拠、代替案とのトレードオフ。
- **NOT in this PR** — scope を明示的に defer して reviewer の質問を防ぐ。
- **Test plan** — 確認したこと / merge 時に確認すべきことの checkbox list。
- **Refs** — RFC セクション、関連 T-task、prior PR。

### 9. CI + review 待ち

- CI: `verify` と `gui e2e` が緑であること。`gui e2e` が PR と無関係に失敗するなら user にエスカレート — red のまま merge しない。
- Review: 人間 + Codex (`codex review --uncommitted` または `gh pr review`)。round は 3 回上限 (`.agents/skills/run-tests/SKILL-ja.md` のレビュー loop convention 参照)。

### 10. Merge

approve 後 `gh pr merge <N> --squash --delete-branch`。squash された commit が `main` の canonical 変更となる。

## 重要な落とし穴

- **Auto-merge race**: auto-merge を有効にした後に PR に追加 commit を push すると、後 commit が land する前に merge が発火する可能性がある。すべての commit を push **してから** approve / auto-merge を有効化する。merge 後 `gh pr view <N> --json mergedAt` で確認 (PR #88 でこれに hit した — commit 1 だけが main に着き、commit 2 は失われた)。
- **Cross-task drift**: T-task が他の進行中 PR と同コードを触る場合、衝突を user に surface する。silently rebase で他の作業を上書きしない。
- **PLAN.v3 変更**: 実装中に T-task scope を拡張 / 分割せざるを得なくなったら、roadmap が現実と一致するよう同 PR で 1 行 edit する。

## 参考パターン

- `feat:` — user が観測できる新挙動。
- `fix:` — bug fix; body で failing test を参照。
- `refactor:` — 挙動変化なし; test は同 coverage で緑のままでなければならない。
- `chore:` — tooling、infra、agent foundation。
- `docs:` — ドキュメントのみ (PRODUCT、PLAN.v3、RFC、`.agents/`)。
- `test:` — test のみ (追加または拡張)。
- `perf:` — 計測された perf 変更; body に before/after 数値を含める。
