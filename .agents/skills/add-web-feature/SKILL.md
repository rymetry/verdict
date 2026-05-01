---
name: add-web-feature
description: Use when adding a new feature, panel, or route to `apps/web`. Covers TanStack Router/Query wiring, shadcn/ui usage, schema-driven data fetching, and the role-aware UI pattern.
---

# Add a feature in the Web GUI

`apps/web` uses Vite + React 19 + TanStack Router + TanStack Query + shadcn/ui + Tailwind v4. Features live under `apps/web/src/features/<feature-name>/`.

## When to use

- A new panel / card / page is being added.
- A new role-specific view (QA / Dev / QMO) needs different data composition over the same run state.
- An existing feature gains a new sub-component or interaction.

## Pre-flight

1. **Read `docs/design/concept-b-refined.html`** — the UI / UX source-of-truth. Color tokens, type scale, spacing, and chip variants are defined there. Do not invent new tokens.
2. **Read the relevant Zod schema** in `packages/shared`. The feature must consume types inferred from there, not from a redefinition. See `.agents/rules/schema-first.md`.
3. **Identify the persona surface** — QA (`/qa`), Dev (`/dev`), or Insights/QMO (`/qmo`). The feature should compose into one (sometimes more, but rarely all three).

## Steps

### 1. Scaffold the feature directory

```
apps/web/src/features/<feature-name>/
├── <FeatureName>Panel.tsx       Main React component
├── <FeatureName>Panel.test.tsx  Vitest unit / integration test
├── types.ts                     UI-internal view models (NOT the API types)
└── README.md (optional)         Feature notes if non-trivial
```

UI-internal types should be derived from the API types via small `pickX(api)` mapper functions, not by re-declaring fields.

### 2. Wire the data layer

Use TanStack Query for all server state. Never `useEffect` + `fetch` for data.

```ts
import { useQuery } from "@tanstack/react-query";
import { ExampleResponseSchema, type ExampleResponse } from "@pwqa/shared";
import { fetchExample } from "@/api/client";

export function useExample(runId: string | undefined) {
  return useQuery({
    queryKey: ["runs", runId, "example"],
    queryFn: () => fetchExample(runId!),
    enabled: typeof runId === "string" && runId.length > 0,
  });
}
```

`fetchExample` lives in `apps/web/src/api/client.ts` and `Schema.parse()`s the response. The hook is consumed in the panel:

```tsx
function ExamplePanel({ runId }: { runId: string }) {
  const query = useExample(runId);
  if (query.isPending) return <SkeletonRow />;
  if (query.isError)   return <ErrorBanner code={query.error?.code} />;
  return <ExampleView data={query.data} />;
}
```

### 3. Compose with shadcn/ui

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

<Card data-testid="<feature>-card">
  <CardHeader className="pb-2">
    <CardTitle className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-[var(--ink-0)]">{LABELS.title}</h3>
      <Badge variant={statusVariant}>{statusLabel}</Badge>
    </CardTitle>
  </CardHeader>
  <CardContent>
    {/* ... */}
  </CardContent>
</Card>
```

Conventions:
- `data-testid="<feature>-..."` on every interactive / queryable element. The e2e tests rely on these.
- Use design tokens (`var(--ink-0)`, `var(--bg-overlay)` etc.) over hex colors.
- Tailwind class order: layout → spacing → typography → color → state.
- Dark / light mode is auto via the existing theme provider; do not bake mode-specific colors into a feature.

### 4. Connect to the route

Mount the panel under the matching persona route:

- QA View: `apps/web/src/routes/qa.tsx`.
- Developer View: `apps/web/src/routes/dev.tsx`.
- Insights / QMO: `apps/web/src/routes/qmo.tsx`.

If the panel is shown across multiple personas, place the shared composition in `apps/web/src/components/` and import from each route.

### 5. Test

Use `@testing-library/react` + Vitest. Mock the API client:

```ts
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, fetchExample: vi.fn() };
});
```

Cover at minimum:

- **Happy path**: provider returns valid data → rendered output asserts on `data-testid` lookups.
- **Loading state**: query pending → skeleton or pending UI is visible.
- **Empty state**: query returns the documented "no data" payload → empty-state UI.
- **Error state**: query errors → user-friendly error UI; assert NO red banner for benign cases (e.g. 404 NOT_ACTIVE for cancel after completion).

### 6. Cross-tab persistence (if applicable)

Some features need to survive navigation between QA / Dev / QMO tabs. Use `useAppStore` (Zustand) with a selector. Do not re-fetch on every mount.

## Forbidden

- `useEffect(() => { fetch(...) }, [])`. Use TanStack Query.
- Re-defining API types inside the feature directory. Import from `@pwqa/shared`.
- Hex / RGB color values in JSX. Use design tokens.
- `console.log` in production paths (it ships in dev builds for invariant violations only).
- Coupling a panel to a specific persona's URL — pass the persona as a prop or read from the router.

## Reviewer checklist

- [ ] Does the feature derive types from `packages/shared` (not redefined locally)?
- [ ] Are `data-testid` selectors used consistently for testable elements?
- [ ] Are loading / empty / error states all covered?
- [ ] Does the test mock the API client and exercise at least 2 states?
- [ ] Does the visual composition use design tokens from `concept-b-refined.html`?
- [ ] If the feature emits a path / artifact link, is it project-relative?

## Related

- `.agents/skills/add-shared-schema/SKILL.md` — define the schema before the panel.
- `.agents/skills/add-agent-route/SKILL.md` — when the panel needs a new endpoint.
- `apps/web/src/features/insights-view/` — reference implementation of a multi-card panel layout.
- `apps/web/src/features/run-console/` — reference for streaming + interactive (cancel) flows.
