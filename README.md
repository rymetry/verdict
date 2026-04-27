# Playwright Workbench

Local-first control plane for existing Playwright projects. The Workbench treats
each Playwright project as the source of truth and adds a GUI layer that runs
tests through the official CLI, captures stdout/stderr/JSON results, and (in
later phases) integrates Allure Report 3, AI failure analysis, and QMO release
summaries.

The current slice implements **Phase 1** of `PLAN.v2.md`:

- `apps/web` — Vite + React 19 GUI with TanStack Query and a native WebSocket
  console.
- `apps/agent` — Local Agent built on Hono + `@hono/node-server` +
  `@hono/node-ws`, exposing the HTTP API and `/ws` channel.
- `packages/shared` — Zod schemas and TypeScript types shared between the GUI
  and the Agent.

Implemented Phase 1 capabilities:

- Project root scan with realpath confinement and an `--allowed-roots` policy.
- `PackageManagerDetector` for npm / pnpm / yarn (Phase 1 targets) plus
  experimental gating for Bun (Phase 1.5). Ambiguous lockfiles or a missing
  `@playwright/test` block test execution.
- `NodeCommandRunner` built on `node:child_process.spawn` with no shell, an
  executable allowlist, env allowlist, secret redaction, timeout, and
  cancellation.
- Test inventory via `playwright test --list --reporter=json`.
- Run pipeline (`POST /runs`) that streams stdout/stderr through `/ws`, saves
  Playwright JSON / HTML / logs under `.playwright-workbench/runs/<runId>/`,
  and surfaces a `failedTests` array for the failure-review panel.

Allure Report 3 (Phase 1.2) and the Bun feasibility spike (Phase 1.5) are not
yet implemented.

## Requirements

- Node.js ≥ 24 (Active LTS "Krypton") — CI matrix covers Node 24 LTS and
  Node 25 (Current). Node 22 was intentionally dropped because it enters
  Maintenance in October 2026.
- pnpm 10.

## Setup

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

## Run locally

```bash
# Terminal A — Local Agent (loopback only by default)
pnpm dev:agent

# Terminal B — GUI (Vite proxies /api and /ws to the Agent)
pnpm dev:web
```

Open <http://127.0.0.1:5173>, paste an absolute path to a Playwright project,
and click **Open**. The Agent enforces `realpath` confinement and only opens
roots that match either the CLI flag or the `WORKBENCH_ALLOWED_ROOTS` env var
(colon-separated list). Without an allowed-roots list the Agent accepts any
locally accessible root the user explicitly chooses.

## CLI options

The Agent accepts the same flags the future `npx playwright-workbench` entry
point will expose:

```bash
node apps/agent/dist/server.js \
  --project /absolute/path/to/playwright-project \
  --port 4317
```

Environment variables:

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP port (default `4317`) |
| `HOST` | Bind host (default `127.0.0.1`) |
| `LOG_LEVEL` | pino log level (default `info`) |
| `WORKBENCH_PROJECT_ROOT` | Initial project root |
| `WORKBENCH_ALLOWED_ROOTS` | `:`-separated allowlist of project roots |

## Architecture

```text
React GUI
  -> HTTP / WebSocket
Local Node Agent (Hono)
  -> file system / process (NodeCommandRunner, no shell)
User Playwright Project
  -> Playwright JSON / HTML / artifacts (Allure in Phase 1.2)
```

`PLAN.v2.md` is the authoritative product and implementation plan.
