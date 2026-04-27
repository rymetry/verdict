# Playwright-native QA Workbench PLAN

## Executive Summary

This repository implements a local-first Playwright QA Workbench. The Workbench treats the user's Playwright code and Git history as the source of truth, and acts as a control plane for project discovery, test inventory, local execution, evidence collection, failure review, Allure Report 3 integration, and release-readiness summaries.

The PoC intentionally avoids a cloud backend and database. It uses a pnpm workspace, a Vite + React frontend, a Node.js Local Agent, shared zod schemas, and a JSON/file store under `.playwright-qa-workbench/` inside the opened Playwright project.

## Product Vision

- Keep Playwright code, fixtures, POMs, config, CLI execution, and CI compatibility intact.
- Give QA engineers a GUI for understanding tests, running tests, inspecting failures, and reviewing evidence.
- Give SDETs and developers readable diffs, command reproducibility, and a safe boundary around local command execution.
- Give QMO / release owners Allure Report links, Quality Gate results, run history, failure summaries, and release-readiness output.

## Architecture

React GUI -> HTTP / WebSocket -> Local Node Agent -> file system / process -> user Playwright project -> Playwright JSON / HTML / Allure Report 3 / artifacts.

Frontend responsibilities:

- Project picker and project health.
- Test inventory.
- Run console.
- Failure review.
- Allure and Playwright report links.
- Quality Gate and QMO summary views.

Local Agent responsibilities:

- Project root validation.
- package manager detection.
- Playwright config/spec discovery.
- AST-based inventory extraction.
- Playwright command construction.
- Command execution through a centralized CommandRunner.
- stdout/stderr streaming.
- JSON/file-store run metadata.
- Allure results/report/quality-gate integration.
- QMO summary generation.

## Source of Truth

- Playwright code and Git remain the source of truth.
- The GUI does not introduce an independent test DSL.
- Workbench-generated files are operational metadata and evidence, not test definitions.
- AI and repair features must produce reviewable diffs before any file changes are applied.

## Package Manager Policy

Workbench itself uses pnpm. Opened Playwright projects may use npm, pnpm, yarn, or bun.

Detection order:

1. Explicit Workbench override.
2. `package.json` `packageManager` field.
3. Single lockfile.
4. Multiple lockfiles with warning and deterministic fallback.
5. npm fallback when no lockfile exists.

Lockfile mapping:

- `package-lock.json`: npm.
- `pnpm-lock.yaml`: pnpm.
- `yarn.lock`: yarn.
- `bun.lock` or `bun.lockb`: bun.

Playwright command templates:

- npm: `npx playwright test`.
- pnpm: `pnpm exec playwright test`.
- yarn: `yarn playwright test`.
- bun: `bunx playwright test`.

## Reporting / Evidence Policy

Initial reporting is Allure Report 3-first, with Playwright JSON and HTML also produced for fallback and machine-readable analysis.

Run output layout:

- `.playwright-qa-workbench/runs/<runId>/metadata.json`
- `.playwright-qa-workbench/runs/<runId>/stdout.log`
- `.playwright-qa-workbench/runs/<runId>/stderr.log`
- `.playwright-qa-workbench/runs/<runId>/playwright-results.json`
- `.playwright-qa-workbench/runs/<runId>/playwright-report/`
- `.playwright-qa-workbench/runs/<runId>/allure-results/`
- `.playwright-qa-workbench/runs/<runId>/allure-report/`
- `.playwright-qa-workbench/runs/<runId>/quality-gate-result.json`
- `.playwright-qa-workbench/runs/<runId>/qmo-summary.json`
- `.playwright-qa-workbench/runs/<runId>/qmo-summary.md`
- `.playwright-qa-workbench/reports/allure-history.jsonl`
- `.playwright-qa-workbench/reports/known-issues.json`

Allure is treated as quality evidence, not as the source of truth for Playwright code. Test code should prefer Playwright-native `test.step()` and `testInfo.attach()`, with Allure-specific metadata behind thin helpers when needed.

## Security Model

- All commands run through CommandRunner.
- Shell execution is not used.
- Commands are represented as executable + args.
- Working directories are constrained to the opened project root.
- Allowed-command policies gate Playwright, package-manager, Allure, Git, and future AI commands.
- stdout/stderr are persisted as evidence and streamed to the GUI.
- Secret-bearing files are not sent to AI context in future phases.
- Patches must be reviewed and checked before temporary application in future repair phases.

## PoC Scope Implemented First

- pnpm workspace.
- Shared zod schemas.
- Fastify Local Agent with WebSocket streaming.
- Project scanner and PackageManagerDetector.
- Basic AST inventory extraction.
- Playwright run command builder.
- NodeCommandRunner.
- JSON/file-store run metadata.
- Playwright JSON result parsing.
- Best-effort Allure Report 3 generation and Quality Gate execution when the opened project has Allure configured.
- React GUI for project opening, inventory, running, logs, failure summary, reports, and QMO summary.

## Roadmap

1. Local Runner PoC.
2. Allure Report 3 Integration PoC.
3. Bun feasibility spike.
4. Failure Review Workbench.
5. AI Analysis / Repair Proposal.
6. Repair Review / Evidence-based Approval.
7. Test Inventory / QA Understanding Layer.
8. Playwright Operations GUI.
9. Config / Fixture / POM Explorer.
10. GitHub / CI Integration.
11. AI Test Planning / Generation Gateway.
12. ReportPortal re-evaluation.

## ReportPortal Position

ReportPortal is not part of the initial PoC. It should be re-evaluated only when centralized multi-team triage, user permissions, assignment workflow, Jira-level integration, long-term cross-project analytics, or ReportPortal's ML triage become necessary. If adopted, it should be added through a ReportProvider rather than replacing Allure historical artifacts.
