# Rule: Schema-first (`packages/shared`)

**Status**: enforced
**EN**: [`schema-first.md`](schema-first.md) (英語版が SoT、本書は理解補助)

`packages/shared/src/index.ts` は HTTP / WebSocket / artifact schema の単一 SoT。`apps/agent` と `apps/web` の両方がそこから infer された TypeScript 型を import する。本 rule はこの 2 者間の API drift を防ぐ。

## 契約

agent / web の境界を跨ぐ payload (HTTP、WebSocket、もう一方が読む persisted JSON) を追加・変更するとき:

1. **Schema first**: `packages/shared/src/index.ts` の Zod schema を定義 / 更新する。build する (`pnpm --filter @pwqa/shared build` または `pnpm typecheck`)。
2. **Agent route**: schema を import、entry で request body を `parse()`、response 用に inferred 型を使用。
3. **Web client**: 同 schema または inferred 型を import。upstream が non-trivial なら受信時に response shape を validate する (特に streaming event)。
4. **Schema を test**: 既知の良い入力 / 悪い入力が round-trip / reject されることを Vitest で確認。

## なぜこの順序が重要か

- `z.infer<typeof Schema>` による TypeScript inference が両側を一致させる。route を先に実装して schema を後付けすると、route の手書き型 annotation が既に drift している。
- Phase 1 PoC レビューで、**3 つの path field がすべて optional** (`filePath`, `relativeFilePath`, `absoluteFilePath`) になり API が consumer に対して曖昧化していた問題が見つかった。Schema-first が design 段階でこれを catch する。
- これが、API client 型を手書きせずに `apps/web` を確実に in sync に保つ唯一のメカニズム。

## 禁止事項

- API 境界を跨ぐ payload 型を `apps/agent` または `apps/web` で直接定義する。
- 形が分かっている field に `z.any()` / `z.unknown()` を当てる — narrow する。`unknown` は本当に opaque な pass-through データに限り許容 (稀)。
- `apps/agent` / `apps/web` で作業する前に `pnpm --filter @pwqa/shared build` を skip する。dist `.d.ts` が他 workspace の consume 対象。

## パターン

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

## レビュアーチェックリスト

- [ ] PR が新しい境界型のために `packages/shared/src/index.ts` を触っているか?
- [ ] agent と web の両方が `@pwqa/shared` から import しているか (再定義していないか)?
- [ ] 新しい shape の Zod schema test があるか?
- [ ] `// @ts-expect-error` 回避なしに `pnpm typecheck` が pass するか?
