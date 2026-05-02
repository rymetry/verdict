# Rule: Shell 不使用 — CommandRunner 経由のみ

**Status**: enforced (security-critical)
**EN**: [`no-shell.md`](no-shell.md) (英語版が SoT、本書は理解補助)

Verdict の CommandRunner (`node:child_process.spawn` 周りの defense-in-depth wrapper) が、`apps/agent` から外部コマンドを実行する **唯一** の経路。**direct `spawn` / `exec` / `execSync` / shell=true variants は `apps/agent/src/` 配下のあらゆる場所で禁止**。

## なぜ

- shell-mode 実行は、引数が user 入力 (project path / run ID / AI 生成 patch / GitHub URL) 由来の場合に command-injection vector を開く。
- Workbench CommandRunner は以下を強制する:
  - 最下層で `shell: false` invariant
  - `argv` 配列形 (文字列連結なし)
  - 許可 executable allowlist
  - cwd boundary check (project root 内の `realpath` containment)
  - env allowlist (default: `PATH`, `HOME`; `WORKBENCH_*` は call 単位で opt-in)
  - `secretRedactor` 経由の secret redaction
  - timeout、cancellation、signal handling (SIGTERM → SIGKILL escalation)
  - audit log entry を `<project>/.playwright-workbench/audit.log` に記録

PLAN.v2 §14 が出典。PLAN.v2 §28 はこれを primary security control として挙げる。

## 契約

agent コードから subprocess を実行するには:

```ts
import type { CommandRunner } from "../commands/runner.js";

async function example(runner: CommandRunner, projectRoot: string) {
  const handle = runner.run({
    executable: "pnpm",
    args: ["exec", "playwright", "test", "--reporter=list,json,html"],
    cwd: projectRoot,
    timeoutMs: 5 * 60 * 1000,
    label: "playwright-test",
    env: { PATH: process.env.PATH! },
  });
  const result = await handle.result;
  return result;
}
```

`runner.run()` は `{ result: Promise<CommandResult>, cancel(): void }` を返す。常に以下を扱うこと:
- `result.timedOut` — 親切な timeout メッセージ。明示的要求なしには timeout 時に retry しない。
- `result.cancelled` — user が cancel を要求した。エラー扱いしない。
- `result.exitCode !== 0` — 失敗を分類する (`apps/agent/src/ai/cliAdapter.ts:classifyNonZeroExit` がパターンの参考)。

## 禁止事項

- `apps/agent/src/` 配下のどこにおいても `import { spawn, exec, execSync, fork } from "node:child_process"` (`apps/agent/test/` の stub harness 用には許可、ただし **shell は絶対 true にしない**)。
- どこでも `shell: true`。
- コマンド文字列を組み立て、それを再 parse する wrapper に通す。
- 以下を伴わずに新しい executable を allowlist に追加する:
  1. policy 更新の近くに正当性のコメント。
  2. allowed と rejected の両形を exercise する unit test。

## 許可済 executable (現状、`apps/agent/src/commands/policy.ts` 参照)

正確なリストはコードに存在する; ここでは複製しない。Phase 1.2 時点では:
- `pnpm`, `pnpx`, `npm`, `npx`, `yarn` (検出された PM 別)
- `playwright` (PM exec 経由のみ)
- `allure` (project-local `node_modules/.bin/` 経由)
- `git` (subcommand のサブセット; 明示要求なしに `--no-verify` 不可)
- `claude` (AI CLI)
- `node` (test stub のみ、dev mode)

hook (`.codex/hooks/*.sh`) は agent の CommandRunner の外で実行される。同じ精神に従う必要がある (no `eval`、unbounded substitution なし、引数 validate)。

## レビュアーチェックリスト

- [ ] PR は subprocess spawn を追加 / 拡張しているか?
- [ ] call は `CommandRunner.run()` を経由しているか?
- [ ] executable は既に policy allowlist にあるか? なければ追加が test されコメントされているか?
- [ ] 引数は `string[]` で渡されているか (shell-substitution の出やすい文字列でないか)?
- [ ] env は最小化されているか (default で `process.env` spread していないか)?
- [ ] 引数中の path は project root containment が validate されているか?
- [ ] 失敗モード path (`timedOut`, `cancelled`, `exitCode !== 0`) の unit test があるか?
