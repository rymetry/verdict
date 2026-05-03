# RFC 0002: 汎用自動開発基盤

| Field | Value |
|---|---|
| Status | Draft |
| Authors | Verdict team |
| Created | 2026-05 |
| Target | Phase 1.5 autonomy foundation |
| Supersedes | — |
| Related | [PRODUCT.md](../PRODUCT.md), [PLAN.v3.md](../PLAN.v3.md), [RFC 0001](0001-workbench-directory.md) |

---

## 1. Motivation

Verdict には `.agents` / `.codex` / `.claude` による自律開発の基盤があるが、現状は
Verdict の PLAN.v3 / T-task / pnpm / GUI smoke に強く結びついている。

今後はこの基盤を捨てずに、他プロジェクトへ移植できる汎用 lifecycle engine として
整理する。上位フローは gstack 型の以下を採用する。

```text
Think -> Plan -> Build -> QA -> Review -> Ship -> optional Deploy/Monitor -> Learn
```

## 2. Goals & Non-goals

### Goals

- 既存の rules / skills / hooks を再利用し、実行可能 driver に昇格する
- Codex と Claude Code の両方で同じ stage contract を扱う
- PR 作成、自動 merge、任意 deploy / canary、学習記録まで v1 で扱う
- Verdict 固有の T-task 処理を adapter に閉じ込める
- 他 repo へ導入できる packageable engine、template、init command を提供する

### Non-goals

- Linear / GitHub Issues adapter の初期実装
- 常駐ブラウザ daemon の実装
- 全 deploy provider の網羅
- 赤 CI や P0/P1 review を無視した自動 merge

## 3. Detailed design

### 3.1 Lifecycle stage

各 stage は `input`, `output`, `status`, `evidence`, `failureClass` を
`.agents/state/timeline.jsonl` に保存する。

| Stage | Contract |
|---|---|
| Think | 作る価値、対象ユーザー、問題、成功条件を decision brief にする |
| Plan | CEO / Eng / Design 観点でスコープ、設計、UI品質、テスト方針を確認する |
| Build | Codex または Claude が repo の rules / skills / hooks を読んで実装する |
| QA | 実ブラウザ検証または project-specific smoke を実行し、結果だけ保存する |
| Review | CI では拾えない本番リスク、テスト不足、境界違反を AI review で検出する |
| Ship | テスト、PR作成、CI polling、review gate、repository policy に合う merge を行う |
| Deploy/Monitor | deploy config がある場合のみ deploy、health check、canary を行う |
| Learn | 成功/失敗、review findings、環境トラブル、project 固有判断を保存する |

### 3.2 Adapter boundary

初期 interface は以下とする。

- `TaskSource`: 次に着手する task を返す
- `Executor`: Build stage を Codex / Claude へ委譲する
- `Verifier`: test / QA / scope gate を評価する
- `Reviewer`: AI review を評価する
- `Publisher`: PR 作成、CI polling、merge を扱う
- `DeployProvider`: deploy、health check、canary を扱う

v1 の generic package built-in は `markdown-roadmap` と `custom-command` を対象にする。
Verdict 固有の `verdict-plan-v3` 相当 picker は repository-local script として
`custom-command` 経由で呼び出す。未実装 adapter は stage
contract を壊さず `ESCALATED` として停止する。

`markdown-roadmap` は generic default の `TaskSource` とする。unchecked Markdown task
を `ROADMAP.md`, `docs/ROADMAP.md`, `docs/roadmap.md`, `TODO.md` から読み、以下のような
id つき task を選択する。

```markdown
- [ ] ROADMAP-1: Add release checklist
- [ ] [ROADMAP-2] Add smoke test
```

### 3.3 State

`.agents/state/` は gitignored の per-machine state とする。

- `progress.json`: active task、PR、merge、deploy 状態
- `timeline.jsonl`: stage ごとの evidence
- `learnings.jsonl`: 再利用価値のある知見
- `lock`: 二重起動防止

既存 repository へ導入する場合、driver は git log や branch history から完了済み task
を推測しない。初回実行前に operator が受け入れ済み baseline を明示する。

```bash
agent-autonomy-progress seed-completed --ids ROADMAP-1,ROADMAP-2
```

この操作は `.agents/state/progress.json` の `completed` を重複なく更新し、
`.agents/state/timeline.jsonl` に evidence を残す。active task と同じ id を
completed に seed することは拒否する。task source が既知 task id を列挙できる場合は
seed id を検証し、不明な id は明示的な `--allow-unknown` なしでは受け付けない。

### 3.4 Ship state machine

PR #99-#102 の dogfood で、Ship stage には以下の判断が必要だった。

- CI polling は `queued` / `in_progress` / `completed` を区別し、red CI は停止する。
  ただし non-required の skipped check は学習として記録しつつ、少なくとも 1 つの
  non-skipped check が成功していれば CI pass と扱う。
- AI review gate は subagent review の完了を待つ。P0/P1 は既存 merge policy の
  `p0-p1` として扱い、P2 も auto-merge 前の blocker として `fail` にする。
- merge method は `squash` を第一候補にし、repository が squash merge を禁止している場合は
  `merge` に fallback する。
- `gh pr merge` が local worktree の `main` 衝突で失敗しても、PR state が `MERGED` なら
  Ship は成功扱いにし、環境 pitfall として Learn に保存する。

この判断は package core の純粋な state machine として実装し、GitHub adapter は
check run / review / merge 結果をこの state machine に渡すだけにする。

## 4. Integration with existing architecture

既存の `pick-next-task`, `execute-t-task`, `verify-completion`, `escape-loop`,
`prepare-release` は Build / Review / Ship の実装部品として再利用する。

`.agents/rules/*` は初期 rule pack として維持する。`.codex/hooks/*` と
`.claude/settings.json` は Codex / Claude 共通 hook template として扱う。

## 5. Versioning & migration

v1 では `.agents/autonomy.config.json` の `version: 1` を唯一の設定 version とする。
将来 version を上げる場合は driver が古い config を読み、警告つきで既定値を補う。

### 5.1 Promotion path to `rymetry/repo-template`

`repo-template` は新規 repository の初期状態を配る場所であり、実装本体を複製する場所ではない。
実行本体は `@rymetry/agent-autonomy` の package / bin として供給し、template repository は
それを呼び出す導線と安全契約を持つ。したがって移植時は以下に分ける。

- `repo-template` に入れる: `.agents/`, `.codex/`, `.claude/`, autonomy config,
  setup script integration, package command の導線
- `repo-template` に入れない: Verdict 固有 adapter、PLAN.v3 / T-task 前提、Allure / E2E
  前提、`packages/autonomy` の source 実装本体

移植前の昇格条件:

1. Verdict で dry-run が安定して成功する。
2. 実 PR 1 本を Ship まで通し、timeline / learnings が診断に使える。
3. generic core と template に Verdict 固有語彙が残っていない。
4. `agents:init` が空 repo に rules / skills / hooks / config を展開できる。
5. `agents:progress seed-completed` で既存 repo の完了済み baseline を明示できる。
6. 既存 file を `--force` なしで上書きしない。
7. package tarball に engine bin と templates が入り、空 repo へ展開できる。
8. `agents:drive --run-deploy` が config なしでは skipped、production approval なしでは blocked、
   canary failure では `CANARY_FAILURE` として記録できる。

### 5.2 Verdict optimization after template migration

`repo-template` への移植後、Verdict は generic foundation の dogfood repo として整理する。

- Generic: lifecycle engine、safety / release gates、template skills / rules
- Verdict-specific: PLAN.v3 task picker、T-task scope policy、GUI smoke / Allure verifier
- Verdict は `repo-template` 由来の generic layer を消費し、固有差分だけを adapter として持つ

## 6. Security considerations

- 自動 merge は CI green、QA pass、review P0/P1 なし、scope check pass、working tree clean の場合のみ
- production deploy は config で `auto` を明示しない限り approval gate を挟む
- 高リスク変更は実装前に停止する
- tool auth failure、network failure、canary failure は `ESCALATED` として記録する
- secrets と per-machine state は commit しない

## 7. Open questions

1. GitHub Issues / Linear adapter をどの順序で追加するか。
2. 常駐ブラウザ daemon を QA stage に入れるか、別 package として扱うか。
3. Learn の保存先を local jsonl から共有 memory store に拡張する時期。

## 8. Examples

Verdict の default config:

```json
{
  "version": 1,
  "workflow": {
    "preset": "default",
    "stages": ["think", "plan", "build", "qa-only", "review", "ship", "learn"]
  },
  "adapters": {
    "taskSource": "custom-command",
    "executor": "codex",
    "verifier": "verdict-verify-completion",
    "reviewer": "codex-review",
    "publisher": "github-pr"
  },
  "taskSources": {
    "customCommand": {
      "command": ["node", ".agents/scripts/pick-verdict-plan-v3.mjs"]
    }
  },
  "safety": {
    "autoMerge": false,
    "maxFailuresPerTask": 3
  }
}
```

AI reviewer を明示 gate に加える場合:

```json
{
  "reviewers": {
    "customCommands": [
      {
        "name": "diff-review",
        "command": ["agent-autonomy-review", "--pr", "{prNumber}"],
        "expectedReviewers": ["diff-review"],
        "timeoutMs": 60000
      },
      {
        "name": "claude-review",
        "command": ["agent-autonomy-ai-review", "--runtime", "claude", "--pr", "{prNumber}"],
        "expectedReviewers": ["claude-review"],
        "timeoutMs": 300000
      }
    ]
  }
}
```

`agent-autonomy-ai-review` は PR diff を stdin 経由で runtime に渡し、diff を
untrusted data として明示する。Claude runtime は tools disabled で実行する。
Codex runtime は現行 CLI に no-tools mode がないため default disabled とし、
`AUTONOMY_ALLOW_CODEX_AI_REVIEW_WITH_TOOLS=true` で明示 opt-in された場合のみ
read-only ephemeral sandbox で実行する。reviewer identity と `expectedReviewers`
は model output ではなく CLI runtime の trusted reviewer 名で固定する。

Deploy つき project は `deploy` を追加する。

```json
{
  "deploy": {
    "enabled": true,
    "environment": "staging",
    "provider": "custom-command",
    "customCommand": ["pnpm", "deploy:staging", "--task", "{taskId}"],
    "healthCheckUrl": "https://example.com/health",
    "productionPolicy": "approval",
    "canary": {
      "enabled": true,
      "customCommand": ["pnpm", "canary:check", "--url", "{healthCheckUrl}"],
      "checks": ["health", "console-errors"]
    }
  }
}
```

Vercel-compatible project は provider を差し替える。`vercel deploy --yes`
を no-shell argv として呼び、stdout の最初の `*.vercel.app` URL
または fallback の最後の non-`vercel.com` URL を `{deployUrl}` として canary
health check に渡す。

```json
{
  "deploy": {
    "enabled": true,
    "environment": "preview",
    "provider": "vercel-compatible",
    "productionPolicy": "approval",
    "canary": { "enabled": true }
  }
}
```

## 9. References

- gstack: https://github.com/garrytan/gstack/tree/main
- RFC 0001: `.workbench/` Directory Specification & Multi-Stage AI Pipeline

## 10. Revision history

- **v0.1** (2026-05): Initial draft.
