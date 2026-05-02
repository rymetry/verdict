---
name: add-shared-schema
description: Use when adding or modifying any payload that crosses the agent/web boundary (HTTP, WebSocket, persisted run JSON). Defines the schema-first workflow that keeps `apps/agent` and `apps/web` in lockstep via `packages/shared`.
---

# Add or modify a shared schema

`packages/shared/src/index.ts` is the single source of truth for cross-boundary types. Both `apps/agent` and `apps/web` import inferred TS types from it. This skill defines the mechanics so the two sides cannot drift.

## When to use

- A new HTTP route is being added to `apps/agent`.
- An existing route changes its request or response shape.
- A new WebSocket event type is introduced.
- A new run-scoped artifact (e.g. a JSON file under `<runDir>/`) needs a schema other code will read.

If the change is purely internal to one workspace (no cross-boundary payload), this skill does not apply.

## Steps

### 1. Define the Zod schema in `packages/shared`

Open `packages/shared/src/index.ts` and add the schema. Conventions:

- Schema name suffix: `Schema` (e.g. `RunStartRequestSchema`, `QmoSummarySchema`).
- Type alias: `export type X = z.infer<typeof XSchema>`.
- Stable status union: prefer named enum schemas (`RunStatusSchema`) over inline `z.enum([...])` in multiple places.
- For optional cross-boundary path fields, follow `.agents/rules/path-safety.md`: use `relativeFilePath: z.string()` (required) and `absoluteFilePath: z.string().optional()` (optional, internal-only consumers).

```ts
export const ExampleResponseSchema = z.object({
  runId: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
  artifacts: z.array(EvidenceArtifactSchema),
  warnings: z.array(z.string()),
});
export type ExampleResponse = z.infer<typeof ExampleResponseSchema>;
```

### 2. Add a Vitest case

In `apps/agent/test/sharedSchema.test.ts` (or a focused test if the schema is large):

```ts
import { ExampleResponseSchema } from "@pwqa/shared";

describe("ExampleResponseSchema", () => {
  it("accepts a minimal valid payload", () => {
    expect(ExampleResponseSchema.parse({
      runId: "run-1",
      status: "passed",
      artifacts: [],
      warnings: [],
    })).toBeDefined();
  });

  it("rejects an invalid status", () => {
    expect(() => ExampleResponseSchema.parse({
      runId: "run-1",
      status: "what",
      artifacts: [],
      warnings: [],
    })).toThrow();
  });
});
```

Cover at minimum: a valid minimal payload + an invalid case for each newly-introduced constraint.

### 3. Build the shared package

```bash
pnpm --filter @pwqa/shared build
```

This emits `.d.ts` into `packages/shared/dist/`, which downstream workspaces consume. Without this step, agent and web cannot see your new types.

### 4. Use the schema in the agent

```ts
import { ExampleResponseSchema, type ExampleResponse } from "@pwqa/shared";

router.get("/runs/:runId/example", async (c) => {
  const data = await buildExample(c.req.param("runId"));
  // Build the payload via TS, then validate at the boundary:
  const payload: ExampleResponse = data;
  return c.json(ExampleResponseSchema.parse(payload));
});
```

`parse()` at the boundary is mandatory for outbound traffic — it enforces that runtime drift is caught even when TS thought everything was fine.

### 5. Use the schema in the web

```ts
import { ExampleResponseSchema, type ExampleResponse } from "@pwqa/shared";
import { parseJson } from "./parse-json";

export async function fetchExample(runId: string): Promise<ExampleResponse> {
  const raw = await parseJson(`/api/runs/${runId}/example`);
  return ExampleResponseSchema.parse(raw);
}
```

The web client `.parse()` call defends against agent-side bugs reaching the React component tree.

### 6. Run typecheck

```bash
pnpm typecheck
```

Must pass cleanly. If it fails, the most common cause is a stale `packages/shared/dist/` — re-run step 3.

## Forbidden

- Defining the same payload type independently in `apps/agent` and `apps/web`. There must be one home: `packages/shared`.
- Returning `z.unknown()` for a field whose shape you know.
- Skipping `pnpm --filter @pwqa/shared build` when downstream code depends on a new export.
- Introducing the schema in the agent first and "promoting it later" — the asymmetry is what causes drift.

## Reference patterns

- Status unions: `QualityGateProfileSchema`, `RunStatusSchema` — define once, reference everywhere.
- Discriminated unions: see `WorkbenchEventSchema` in `packages/shared/src/index.ts` for the WS event pattern.
- Path fields: `FailedTestSchema` and `EvidenceArtifactSchema` for the relative/absolute pair.
- Persistence schemas: `RunMetadataSchema`, `QmoSummarySchema` — these double as the file-on-disk format and the API response.

## Related

- `.agents/rules/schema-first.md` — the rule this skill enforces.
- `.agents/rules/path-safety.md` — for path-bearing fields.
- `.agents/skills/add-agent-route/SKILL.md` — for routing the new schema through HTTP.
- `.agents/skills/add-web-feature/SKILL.md` — for consuming the schema in the GUI.
