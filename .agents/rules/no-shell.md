# Rule: No Shell — CommandRunner Only

**Status**: enforced (security-critical)

Verdict's CommandRunner (defense-in-depth wrapper around `node:child_process.spawn`) is the only path through which `apps/agent` may execute external commands. **Direct `spawn`, `exec`, `execSync`, or shell=true variants are forbidden** anywhere under `apps/agent/src/`.

## Why

- Shell-mode execution opens command-injection vectors when any argument originates from user input (project paths, run IDs, AI-generated patches, GitHub URLs).
- The Workbench CommandRunner enforces:
  - `shell: false` invariant at the lowest level
  - `argv` array shape (no string concatenation)
  - Allowed-executable allowlist
  - cwd boundary check (`realpath` containment in project root)
  - env allowlist (defaults: `PATH`, `HOME`; `WORKBENCH_*` opted-in per call)
  - Secret redaction via `secretRedactor`
  - Timeout, cancellation, signal handling (SIGTERM → SIGKILL escalation)
  - Audit log entry at `<project>/.playwright-workbench/audit.log`

PLAN.v2 sec 14 is the source. PLAN.v2 sec 28 lists this as the primary security control.

## The contract

To run a subprocess from agent code:

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

`runner.run()` returns `{ result: Promise<CommandResult>, cancel(): void }`. Always handle:
- `result.timedOut` — friendly timeout message, no retry on timeout unless explicitly requested.
- `result.cancelled` — user requested cancel; do not treat as error.
- `result.exitCode !== 0` — classify the failure (see `apps/agent/src/ai/cliAdapter.ts:classifyNonZeroExit` for the pattern).

## Forbidden

- `import { spawn, exec, execSync, fork } from "node:child_process"` anywhere under `apps/agent/src/` (allowed under `apps/agent/test/` for stub harnesses **with shell never set to true**).
- `shell: true` anywhere.
- Building a command string and passing it through any wrapper that re-parses it.
- Adding a new executable to the allowlist without:
  1. A justification comment near the policy update.
  2. A unit test that exercises the new policy path with both allowed and rejected forms.

## Allowed executables (current, see `apps/agent/src/commands/policy.ts`)

The exact list lives in code; do not duplicate it here. As of Phase 1.2, it includes:
- `pnpm`, `pnpx`, `npm`, `npx`, `yarn` (per detected PM)
- `playwright` (via PM exec only)
- `allure` (via project-local `node_modules/.bin/`)
- `git` (subset of subcommands; never `--no-verify` unless explicitly asked)
- `claude` (AI CLI)
- `node` (test stubs only, dev mode)

Hooks (`.codex/hooks/*.sh`) execute outside the agent's CommandRunner; they must follow the same spirit (no `eval`, no unbounded substitution, validate args).

## Reviewer checklist

- [ ] Does the PR add or extend any subprocess spawn?
- [ ] Is the call routed through `CommandRunner.run()`?
- [ ] Does the executable already appear in the policy allowlist? If not, is the addition tested + commented?
- [ ] Are arguments passed as `string[]` (no shell-substitution-prone strings)?
- [ ] Is the env minimized (no `process.env` spread by default)?
- [ ] Are paths in arguments validated for project-root containment?
- [ ] Is there a unit test for the failure-mode paths (`timedOut`, `cancelled`, `exitCode !== 0`)?
