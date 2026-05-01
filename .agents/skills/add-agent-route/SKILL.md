---
name: add-agent-route
description: Use when adding a new HTTP route or WebSocket event in `apps/agent`. Covers Hono router wiring, schema validation, error mapping, audit log, and tests against the route.
---

# Add an HTTP / WebSocket route in the Agent

Verdict's agent uses Hono on top of `@hono/node-server`. WebSocket lives at `/ws` via `@hono/node-ws`. Routes are organized by domain under `apps/agent/src/routes/` and registered in `apps/agent/src/server.ts`.

## When to use

- A new feature requires an HTTP endpoint (REST-shaped, JSON in/out).
- A new WS event type needs to be broadcast to the GUI.
- An existing route's input or output shape changes.

## Pre-flight

1. **Schema first.** Read `.agents/skills/add-shared-schema/SKILL.md`. The route's request and response types must come from `packages/shared`. Do not start route implementation until the schema is committed and `pnpm --filter @pwqa/shared build` has been run.
2. **No-shell.** If the route triggers a subprocess, route it through `CommandRunner`. See `.agents/rules/no-shell.md`.
3. **Path safety.** Any path returned in the response must be project-relative. See `.agents/rules/path-safety.md`.

## Steps

### 1. Pick the right router file

Domain split (current convention):

| File | Domain |
|---|---|
| `apps/agent/src/routes/projects.ts` | Project open / current / config summary |
| `apps/agent/src/routes/runs.ts` | Run lifecycle, artifacts, AI, repair |
| `apps/agent/src/routes/health.ts` | Health, version |

If your route does not belong to any of the above, create a new file (e.g. `qmo.ts`) and import it from `server.ts`.

### 2. Add the route

```ts
import { ExampleResponseSchema, ExampleRequestSchema, type ExampleResponse } from "@pwqa/shared";

router.post("/runs/:runId/example", async (c) => {
  const body = ExampleRequestSchema.parse(await c.req.json());
  const runId = c.req.param("runId");

  const result = await runManager.example({ runId, body });

  const payload: ExampleResponse = mapToResponse(result);
  return c.json(ExampleResponseSchema.parse(payload));
});
```

Conventions:
- Validate request body with `Schema.parse(await c.req.json())` at entry.
- Validate response with `Schema.parse(payload)` at exit.
- 4xx errors: throw a typed error (or use `apiError(c, code, message, status)`); never let an unhandled exception escape.
- 5xx errors: log via `pino` with `errorLogFields(error)`; surface a stable `code` to the client (e.g. `RUN_NOT_FOUND`, `AI_CLI_FAILED`). The user should never see a raw stack.

### 3. Subprocess (if applicable)

If the route launches a subprocess:

```ts
const handle = runner.run({
  executable: "pnpm",
  args: ["exec", "playwright", "test", ...filter],
  cwd: projectRoot,
  timeoutMs: 5 * 60 * 1000,
  label: "playwright-test",
  env: { PATH: process.env.PATH! },
});
const result = await handle.result;
```

Handle the failure modes explicitly:
- `result.timedOut` → return a structured timeout payload (do not retry implicitly).
- `result.cancelled` → emit a `cancelled` event; do not treat as error.
- `result.exitCode !== 0` → classify per the existing pattern (`apps/agent/src/ai/cliAdapter.ts:classifyNonZeroExit`).

### 4. WebSocket events

Events use the existing dispatcher in `apps/agent/src/events/`. To add a new event type:

1. Add the discriminant to `WorkbenchEventSchema` in `packages/shared/src/index.ts`.
2. Define the payload schema and merge into the union.
3. Use `eventBus.publish({ type: "...", runId, sequence, timestamp, payload })` from inside the agent code.
4. The WS frontend reads via the existing `EventStream` abstraction; no change to plumbing if the event is a new variant of a known shape.

Sequence numbers are issued by the bus; **do not** invent your own. Re-connecting clients use the sequence to deduplicate / re-pull.

### 5. Audit log

Every subprocess invocation auto-emits an audit-log entry via the runner. For non-subprocess routes that mutate state (e.g. apply a patch, persist a config), add an explicit `logger.info(..., "operation summary")` with structured fields so the audit trail is reproducible.

### 6. Tests

Write at least three tests per route:

1. **Happy path** — valid input, valid output, schema parses on both sides.
2. **Validation rejection** — invalid request body returns 400 with stable code.
3. **Failure mode** — the most likely upstream failure (subprocess timeout, file not found, repository dirty) returns the right code without leaking secrets/paths.

Test file location: `apps/agent/test/<domain>.test.ts` (e.g. `runs.test.ts`).

For routes that depend on the file system, use the `tmpdir`-rooted fixtures already established in `apps/agent/test/runManager.test.ts`.

## Forbidden

- Hand-typing a response object without validating against the schema at exit.
- Using `c.json(...)` on an `unknown` payload without `Schema.parse`.
- Swallowing errors with `try {} catch {}` or `.catch(() => undefined)`. Use a typed wrapper or rethrow.
- Calling `runManager.startRun` (or other long-running operations) without timeout / cancellation handling.
- Returning a raw `error.stack` to the client.

## Reviewer checklist

- [ ] Request and response are both Zod-parsed at the boundary.
- [ ] Error responses use stable string codes (no UUIDs / no English-only messages).
- [ ] Subprocess paths route through `CommandRunner`.
- [ ] Path-bearing fields are project-relative.
- [ ] Tests cover happy path + 1 validation + 1 failure mode.
- [ ] WS event payloads match the discriminated union schema in `packages/shared`.

## Related

- `.agents/skills/add-shared-schema/SKILL.md` — pre-requisite step.
- `.agents/rules/no-shell.md` — subprocess constraints.
- `.agents/rules/path-safety.md` — path normalization.
- `.agents/rules/secret-handling.md` — env / log discipline.
- `apps/agent/src/routes/runs.ts` — the most-developed reference; mirror its patterns.
