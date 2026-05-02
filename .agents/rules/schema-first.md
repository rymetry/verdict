# Rule: Schema-first (`packages/shared`)

**Status**: enforced

`packages/shared/src/index.ts` is the single source of truth for HTTP / WebSocket / artifact schemas. Both `apps/agent` and `apps/web` import the inferred TypeScript types from it. This rule prevents API drift between the two.

## The contract

When you add or change a payload that crosses the agent/web boundary (HTTP, WebSocket, persisted JSON read by the other side):

1. **Schema first**: define or update the Zod schema in `packages/shared/src/index.ts`. Build it (`pnpm --filter @pwqa/shared build` or `pnpm typecheck`).
2. **Agent route**: import the schema, `parse()` request bodies at entry, and use the inferred type for the response.
3. **Web client**: import the same schema or its inferred type. Validate response shape on receipt where the upstream is non-trivial (especially for streamed events).
4. **Test the schema**: add a Vitest case that ensures known good and known bad inputs round-trip / reject as expected.

## Why this order matters

- TypeScript inference from `z.infer<typeof Schema>` keeps both sides in lockstep. If you implement the route first and define the schema afterwards, the route's manual type annotations will already have drifted.
- The Phase 1 PoC review found that **3 path fields all optional** (`filePath`, `relativeFilePath`, `absoluteFilePath`) made the API ambiguous for consumers. Schema-first catches that during design.
- It is the only mechanism that reliably keeps `apps/web` in sync without hand-written API client types.

## Forbidden

- Defining a payload type in `apps/agent` or `apps/web` directly when it crosses the API boundary.
- Adding `z.any()` or `z.unknown()` for a field whose shape you know — narrow it. `unknown` is acceptable only for genuinely opaque pass-through data (rare).
- Skipping the `pnpm --filter @pwqa/shared build` step before working in `apps/agent` or `apps/web`. The dist `.d.ts` files are what the other workspaces consume.

## Pattern

```ts
// packages/shared/src/index.ts
export const ExampleResponseSchema = z.object({
  runId: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
  artifacts: z.array(EvidenceArtifactSchema),
});
export type ExampleResponse = z.infer<typeof ExampleResponseSchema>;
```

```ts
// apps/agent/src/routes/runs.ts
import { ExampleResponseSchema, type ExampleResponse } from "@pwqa/shared";

router.get("/runs/:runId/example", async (c) => {
  const payload: ExampleResponse = { /* ... */ };
  return c.json(ExampleResponseSchema.parse(payload));
});
```

```ts
// apps/web/src/api/client.ts
import { ExampleResponseSchema, type ExampleResponse } from "@pwqa/shared";

export async function fetchExample(runId: string): Promise<ExampleResponse> {
  const raw = await parseJson(`/api/runs/${runId}/example`);
  return ExampleResponseSchema.parse(raw);
}
```

## Reviewer checklist

- [ ] Did the PR touch `packages/shared/src/index.ts` for any new boundary type?
- [ ] Are agent and web both importing from `@pwqa/shared` (not redefining)?
- [ ] Is there a Zod schema test for the new shape?
- [ ] Does `pnpm typecheck` pass without `// @ts-expect-error` workarounds?
