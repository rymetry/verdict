# Playwright QA Workbench

Local-first control plane for existing Playwright projects.

The Workbench keeps Playwright code and Git as the source of truth. It starts as a pnpm monorepo with a Vite React GUI, a Node.js Local Agent, and shared zod schemas.

## Current Slice

This repository currently contains the Phase 1 foundation:

- `apps/web`: Vite + React shell.
- `apps/agent`: Fastify Local Agent with `GET /health`.
- `packages/shared`: shared zod schemas and TypeScript types.
- pnpm workspace and TypeScript project setup.

Project scanning, package-manager detection, Playwright execution, WebSocket run streaming, and Allure Report 3 integration are the next vertical slices.

## Requirements

- Node.js 24 is currently used in local verification.
- pnpm 10.

## Setup

```bash
pnpm install
pnpm typecheck
pnpm build
```

## Run Locally

Start the Local Agent:

```bash
pnpm dev:agent
```

Check the Agent:

```bash
curl -sL http://127.0.0.1:4317/health
```

Start the web app:

```bash
pnpm dev:web
```

Then open `http://127.0.0.1:5173`.

## Architecture

```text
React GUI
  -> HTTP / WebSocket
Local Node Agent
  -> file system / process
User Playwright Project
  -> Playwright JSON / HTML / Allure Report 3 / artifacts
```

The detailed product and implementation plan lives in `PLAN.md`.
