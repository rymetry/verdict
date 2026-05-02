# Verdict — AI Agent Context

> Cross-tool primary context for any AI coding agent (Codex, Claude Code, Gemini CLI, etc.) working on this repository. This file is the **first thing an agent should read**.
>
> Tool-specific entry points: `CLAUDE.md` (Claude Code), `.codex/config.toml` (OpenAI Codex). Both ultimately defer to this document.

---

## 1. What this project is

**Verdict** is an AI-native software quality integration platform.

It is a self-hostable OSS that turns testing from "a specialist skill held by code-readers" into "shared organizational knowledge" — QA, QMO, Dev, and SDET reach release decisions on a single shared screen.

- **Vision**: [`docs/product/PRODUCT.md`](docs/product/PRODUCT.md) ([English](docs/product/PRODUCT.en.md))
- **Roadmap**: [`docs/product/PLAN.v3.md`](docs/product/PLAN.v3.md)
- **Phase 1 implementation reference (active)**: [`PLAN.v2.md`](PLAN.v2.md)
- **Phase 1.5 architecture (next focus)**: [`docs/product/rfcs/0001-workbench-directory.md`](docs/product/rfcs/0001-workbench-directory.md)

Phase 1 / 1.2 are **complete**. Phase 1.5 (AI-native multi-stage pipeline) is in design and is the active development target.

## 2. Repository layout

This is a pnpm workspace monorepo at Node.js ≥ 24, pnpm 10.

```
apps/
├── agent/          Local Agent (Hono + ws + child_process; HTTP/WS API)
└── web/            GUI (Vite + React 19 + TanStack Router/Query + shadcn/ui)
packages/
└── shared/         Cross-cutting Zod schemas + TypeScript types
tests/
├── fixtures/       Sample Playwright projects (e.g. sample-pw-allure-project)
└── ...
e2e/                GUI smoke + Allure pipeline E2E
docs/
├── product/        PRODUCT.md, PLAN.v3, RFCs, test-plan-samples (vision/spec)
├── design/         UI mockups + UX source-of-truth
├── operations/     PoC operations guide, ReportPortal re-evaluation, Bun spike
└── ...
```

The agent never accesses anything outside the project root passed via `--project` (or `WORKBENCH_PROJECT_ROOT`). All file ops go through `realpath` confinement.

## 3. Tech stack & versions

- **Runtime**: Node.js ≥ 24 (Active LTS "Krypton"). Node 22 is NOT supported.
- **Package manager**: pnpm 10.8.0 (pinned via `packageManager`).
- **Build**: `tsc` (no bundler in agent), Vite (web only).
- **Test**: Vitest (unit/integration), Playwright (e2e — see `e2e/`).
- **Lint/format**: TypeScript `strict` mode + zod schemas. No ESLint/Prettier wired in CI today.
- **Schemas**: Zod is the source of truth in `packages/shared`. Types are inferred via `z.infer<>`.

## 4. Daily commands

> **First-time bootstrap (fresh worktree / Codex sandbox)**: A new worktree or a sandboxed agent session may have an empty `node_modules`. Run `pnpm install` BEFORE attempting `pnpm add <dep>` or any `pnpm build` / `pnpm typecheck`. If the sandbox blocks DNS to `registry.npmjs.org`, surface that to the user and request approval to re-run `pnpm install` from outside the sandbox — do NOT silently retry `pnpm install --offline --force`, which can leave `node_modules` in a half-rebuilt state when the local pnpm store is missing tarballs.

```bash
# Setup
pnpm install
pnpm typecheck      # all workspaces, including agent test typecheck
pnpm build          # shared → agent → web
pnpm test           # vitest in agent + web

# Dev (two terminals)
pnpm dev:agent      # http://127.0.0.1:4317
pnpm dev:web        # http://127.0.0.1:5173, proxies /api and /ws to agent

# E2E
pnpm smoke:gui              # GUI smoke against the dev servers
pnpm smoke:gui:allure       # Full Allure pipeline E2E
pnpm e2e                    # Full e2e (heavier)
```

## 5. Critical conventions (DO NOT violate without explicit user approval)

These are enforced as `.agents/rules/`. The most load-bearing ones:

- **Schema-first**: changing an HTTP/WS payload requires updating `packages/shared` zod schema **before** touching the route or the UI. See [`.agents/rules/schema-first.md`](.agents/rules/schema-first.md).
- **No shell execution**: agent subprocess execution goes through `CommandRunner` only (argv array, no shell). See [`.agents/rules/no-shell.md`](.agents/rules/no-shell.md).
- **Path safety**: API responses, Markdown drafts, and AI context emit project-relative paths only. Absolute paths are stored internally and stripped at the boundary. See [`.agents/rules/path-safety.md`](.agents/rules/path-safety.md).
- **Secret handling**: explicit env allowlist, redaction at the runner, never persist raw secrets in run artifacts. See [`.agents/rules/secret-handling.md`](.agents/rules/secret-handling.md).
- **Code style**: TypeScript strict, immutable updates, no `any`, schema-validate at boundaries, prefer small files. See [`.agents/rules/code-style.md`](.agents/rules/code-style.md).
- **Documentation policy**: PLAN.v2 is implementation reference (frozen for Phase 1); PLAN.v3 is roadmap; RFCs sit in `docs/product/rfcs/`. See [`.agents/rules/documentation-policy.md`](.agents/rules/documentation-policy.md).

## 6. Reusable workflows (skills)

Common multi-step tasks have a corresponding skill in `.agents/skills/`. Agents should invoke (or read) the relevant skill before starting:

- **Adding a new shared schema** — [`.agents/skills/add-shared-schema/SKILL.md`](.agents/skills/add-shared-schema/SKILL.md)
- **Adding an HTTP/WS route in the Agent** — [`.agents/skills/add-agent-route/SKILL.md`](.agents/skills/add-agent-route/SKILL.md)
- **Adding a feature in the Web GUI** — [`.agents/skills/add-web-feature/SKILL.md`](.agents/skills/add-web-feature/SKILL.md)
- **Executing a T-task from PLAN.v3** — [`.agents/skills/execute-t-task/SKILL.md`](.agents/skills/execute-t-task/SKILL.md)
- **Writing or revising an RFC** — [`.agents/skills/write-rfc/SKILL.md`](.agents/skills/write-rfc/SKILL.md)
- **Running tests / interpreting failures** — [`.agents/skills/run-tests/SKILL.md`](.agents/skills/run-tests/SKILL.md)
- **Preparing a release-ready commit + PR** — [`.agents/skills/prepare-release/SKILL.md`](.agents/skills/prepare-release/SKILL.md)

**Autonomy loop (pick → execute → verify → review → merge → next):**

- **Picking the next unblocked T-task** — [`.agents/skills/pick-next-task/SKILL.md`](.agents/skills/pick-next-task/SKILL.md)
- **Verifying a T-task PR is complete** — [`.agents/skills/verify-completion/SKILL.md`](.agents/skills/verify-completion/SKILL.md)
- **Persisting / resuming loop progress** — [`.agents/skills/checkpoint-progress/SKILL.md`](.agents/skills/checkpoint-progress/SKILL.md)
- **Detecting a stuck loop and escalating** — [`.agents/skills/escape-loop/SKILL.md`](.agents/skills/escape-loop/SKILL.md)
- **Driving one iteration of the loop** — [`.agents/skills/drive-next-task/SKILL.md`](.agents/skills/drive-next-task/SKILL.md)

The autonomy loop is opt-in. Default mode is semi-autonomous: the loop drives Codex hand-off and verification, then stops at "ready to merge" for human approval. Setting `AUTONOMY_AUTO_MERGE=true` lets the loop merge after CI + Codex review pass. State lives at `.agents/state/progress.json` (gitignored).

Skills are project-scoped under `.agents/skills/` per the [Agent Skills open standard](https://agentskills.io). Codex discovers them automatically. Claude Code discovers them via `.claude/skills/` symlink (or, if symlinks are not honored, by reading them directly through the SKILL tool).

### Choosing where a new skill belongs

When you need a new reusable workflow, decide its scope before drafting:

- **Project-specific** → `.agents/skills/<name>/SKILL.md` here. The skill depends on Verdict's domain (Hono router shape, `@pwqa/shared` schema, Allure pipeline, T-task framework, etc.) and would not transfer to another repo.
- **Cross-project / personal** → user-global at `~/.claude/skills/<name>/` or a dedicated marketplace plugin. The skill is language- or tool-cross-cutting (TDD habits, code-review patterns, GitHub PR triage) and would be reused across many repos.
- **Unsure** → ask the user before drafting. Moving a skill later breaks path references and discovery; the cost of a one-line check up front is much lower than a rename PR later.

When in doubt, prefer project-specific in `.agents/skills/`. Promotion to user-global is easy; demotion has friction.

## 7. Hook contract

Both Claude Code and Codex run lightweight hooks at agent loop boundaries. The actual scripts live under `.codex/hooks/` and are invoked by **both** tools:

- **PreToolUse(Bash)** → `.codex/hooks/pre-tool-use-policy.sh` — checks dangerous commands (e.g. `git push --force` on `main`, writes outside project root).
- **PostToolUse(Edit|Write)** → `.codex/hooks/post-tool-use-typecheck.sh` — runs targeted typecheck on changed TS package, surfaces immediate errors.
- **Stop** → `.codex/hooks/stop-verify.sh` — final smoke (typecheck + targeted test) before yielding to the user.

Hooks are advisory by default — they do not block, only warn — except for the `pre-tool-use-policy.sh` checks, which block destructive operations on protected branches.

## 8. Don'ts (project-wide)

- ❌ Never bypass `CommandRunner` to spawn a process directly (use `runner.run({ executable, args })`).
- ❌ Never `git push --force` on `main`; always use `--force-with-lease` on a PR branch.
- ❌ Never persist raw absolute paths in API responses, QMO Markdown, or AI context. Use relative.
- ❌ Never call real third-party APIs (Stripe / GitHub / Slack) from tests; mock or use the project's MSW layer.
- ❌ Never modify `PLAN.v2.md` to retcon Phase 1 history. Add follow-ups to PLAN.v3 instead.
- ❌ Never skip `git apply --check` before applying an AI-proposed patch.
- ❌ Never delete or rewrite git history that has been pushed to `origin/main`.
- ❌ Never commit secrets, `.env` contents, or contents of `~/.codex/auth.json` / `~/.claude/auth.json`.
- ❌ Never `rm` an auto-renamed backup file (`*.backup`, `*.orig`, `*.pre-*`, `*.bak`, `*~`) without first `cat`-ing it into the conversation. These files are produced by upgrades / migrations / merge tools and may carry the only remaining copy of important state — surface the contents at least once before removing.

## 9. Glossary

- **T-task** — a numbered task in PLAN.v3 (e.g. `T1500-3` is "Exploration Engine"). Tasks are the unit of PR scope.
- **QMO** — Quality Management Owner; the persona responsible for ship/no-ship decisions.
- **Quality Gate** — Allure CLI evaluation profile (`local-review` advisory; `release-smoke` strict; `full-regression` ≥95%).
- **Allure pipeline** — detect → archive → run → copy → report → quality-gate → QMO summary lifecycle in `apps/agent/src/playwright/runManager.ts`.
- **Repair Review** — flow that takes an AI-generated patch through `git apply --check` → temporary apply → rerun → before/after comparison → approve.
- **Run-scoped artifact** — anything under `<project>/.playwright-workbench/runs/<runId>/`. Never overwritten across runs.

## 10. Communication conventions

- **Issue / PR titles**: `<type>: <imperative description>` (e.g. `feat: add AI test plan generator`, `fix: clamp successRate at 0-test boundary`). Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`.
- **Branch names**: `<type>/<short-kebab>` (e.g. `feat/T1500-3-exploration-engine`, `chore/agent-foundation`).
- **Commit messages**: imperative subject ≤72 chars, body wraps at ~78. No marketing fluff. Reference T-task ID when applicable.
- **PR descriptions**: include Summary, Why-this-PR, Test plan, NOT-in-this-PR sections (see prior PRs #88/#89 for the template).
- **Co-authored-by tags**: disabled globally per `~/.claude/settings.json`. Do not add Claude/Codex co-author lines unless the user re-enables them for a specific commit.

## 11. When in doubt

1. Skim the relevant rule under `.agents/rules/`.
2. If a multi-step workflow exists, follow the matching skill in `.agents/skills/`.
3. Read the relevant section of PLAN.v3 (for direction) or PLAN.v2 (for already-implemented invariants).
4. Surface the ambiguity to the user with a concrete proposal rather than asking open-ended questions.

---

**License**: Apache 2.0 ([`LICENSE`](LICENSE)) · **Repo**: `rymetry/verdict` (formerly `playwright-workbench`)
