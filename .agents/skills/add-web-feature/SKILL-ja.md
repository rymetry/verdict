---
name: add-web-feature
description: `apps/web` に新規 feature / panel / route を追加するときに使う。TanStack Router/Query 配線、shadcn/ui 利用、schema-driven なデータ取得、role-aware UI パターンをカバーする。
---

# Web GUI に feature を追加する

> EN: [`SKILL.md`](SKILL.md) (英語版が SoT、本書は理解補助)

`apps/web` は Vite + React 19 + TanStack Router + TanStack Query + shadcn/ui + Tailwind v4 を使用。Feature は `apps/web/src/features/<feature-name>/` 配下に置く。

## いつ使うか

- 新 panel / card / page を追加する。
- 同じ run state について QA / Dev / QMO のロール別 view が異なる data composition を必要とする。
- 既存 feature が新 sub-component / interaction を獲得する。

## Pre-flight

1. **`docs/design/concept-b-refined.html` を読む** — UI / UX SoT。color token、type scale、spacing、chip variant が定義されている。新 token を invent しない。
2. **関連 Zod schema** を `packages/shared` で読む。Feature はそこから infer された型を consume する; redefine しない。`.agents/rules/schema-first-ja.md` 参照。
3. **persona surface を識別する** — QA (`/qa`)、Dev (`/dev`)、Insights/QMO (`/qmo`)。Feature は (通常 1 つ、稀に複数の) persona に compose されるべき。

## 手順

### 1. Feature directory を scaffold

```
apps/web/src/features/<feature-name>/
├── <FeatureName>Panel.tsx       メインの React component
├── <FeatureName>Panel.test.tsx  Vitest unit / integration test
├── types.ts                     UI 内部 view model (API 型ではない)
└── README.md (optional)         feature が non-trivial なら notes
```

UI 内部型は API 型から `pickX(api)` のような小さな mapper 関数で derive する; field を再宣言しない。

### 2. データ層を配線

server state はすべて TanStack Query。`useEffect` + `fetch` でデータ取得しない。

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

`fetchExample` は `apps/web/src/api/client.ts` に置き、response を `Schema.parse()` する。hook は panel で consume:

```tsx
function ExamplePanel({ runId }: { runId: string }) {
  const query = useExample(runId);
  if (query.isPending) return <SkeletonRow />;
  if (query.isError)   return <ErrorBanner code={query.error?.code} />;
  return <ExampleView data={query.data} />;
}
```

### 3. shadcn/ui で compose

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

規約:
- すべての interactive / queryable 要素に `data-testid="<feature>-..."`。e2e test がこれに依存する。
- hex color より design token (`var(--ink-0)`、`var(--bg-overlay)` 等) を使用。
- Tailwind class 順序: layout → spacing → typography → color → state。
- dark / light mode は既存 theme provider で auto。feature 内で mode 固有色を bake しない。

### 4. Route に接続

panel をマッチする persona route 配下に mount:

- QA View: `apps/web/src/routes/qa.tsx`。
- Developer View: `apps/web/src/routes/dev.tsx`。
- Insights / QMO: `apps/web/src/routes/qmo.tsx`。

複数 persona をまたぐ panel は、共通 composition を `apps/web/src/components/` に置き、各 route から import する。

### 5. テスト

`@testing-library/react` + Vitest を使う。API client を mock:

```ts
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, fetchExample: vi.fn() };
});
```

最低限カバーする:

- **Happy path**: provider が valid データを返す → `data-testid` lookup で出力を assert。
- **Loading state**: query pending → skeleton or pending UI が見える。
- **Empty state**: query が文書化された "no data" payload を返す → empty-state UI。
- **Error state**: query が error → user-friendly な error UI; 良性 case (例: cancel 後 completion 時の 404 NOT_ACTIVE) で red banner にしないことを assert。

### 6. cross-tab 永続性 (該当時)

QA / Dev / QMO tab 間の navigation を生き残る必要がある feature がある。`useAppStore` (Zustand) を selector 付きで使用。マウントごとに re-fetch しない。

## 禁止事項

- `useEffect(() => { fetch(...) }, [])`。TanStack Query を使う。
- feature directory 内で API 型を再定義する。`@pwqa/shared` から import。
- JSX 内で hex / RGB color 値。design token を使う。
- production path で `console.log` (dev build で invariant 違反 log だけに使われている)。
- panel を特定 persona の URL に couple する。persona を prop で渡すか router から読む。

## レビュアーチェックリスト

- [ ] feature は `packages/shared` から型を derive しているか (local 再定義していないか)?
- [ ] testable element に `data-testid` が一貫使用されているか?
- [ ] loading / empty / error state がカバーされているか?
- [ ] test が API client を mock し、最低 2 state を exercise しているか?
- [ ] visual composition が `concept-b-refined.html` の design token を使っているか?
- [ ] feature が path / artifact link を emit するなら project-relative か?

## 関連

- `.agents/skills/add-shared-schema/SKILL-ja.md` — panel 前に schema を定義。
- `.agents/skills/add-agent-route/SKILL-ja.md` — panel が新 endpoint を必要とするとき。
- `apps/web/src/features/insights-view/` — multi-card panel layout の reference 実装。
- `apps/web/src/features/run-console/` — streaming + interactive (cancel) フローの reference。
