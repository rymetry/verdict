---
name: add-shared-schema
description: agent / web の境界を跨ぐ payload (HTTP / WebSocket / 永続化された run JSON) を追加・修正するときに使う。`packages/shared` 経由で `apps/agent` と `apps/web` を lockstep に保つ schema-first ワークフローを定義する。
---

# shared schema を追加・修正する

> EN: [`SKILL.md`](SKILL.md) (英語版が SoT、本書は理解補助)

`packages/shared/src/index.ts` がクロス境界型の単一 SoT。`apps/agent` と `apps/web` は両方そこから infer された TS 型を import する。本 skill は両側が drift できないようにする mechanic を定義する。

## いつ使うか

- 新 HTTP route が `apps/agent` に追加される。
- 既存 route の request / response shape が変わる。
- 新 WebSocket event 型が導入される。
- 別コードが読む新しい run-scoped artifact (例: `<runDir>/` 下の JSON) に schema が必要。

変更が 1 workspace 内部に閉じる (クロス境界 payload なし) 場合、本 skill は適用されない。

## 手順

### 1. `packages/shared` で Zod schema 定義

`packages/shared/src/index.ts` を開いて schema を追加。規約:

- schema 名 suffix: `Schema` (例: `RunStartRequestSchema`、`QmoSummarySchema`)。
- 型 alias: `export type X = z.infer<typeof XSchema>`。
- 安定 status union: 複数箇所で inline `z.enum([...])` を書くより named enum schema (`RunStatusSchema`) を優先。
- クロス境界 path field の場合は `.agents/rules/path-safety-ja.md` に従う: `relativeFilePath: z.string()` (必須) と `absoluteFilePath: z.string().optional()` (optional、internal-only consumer)。

```ts
export const ExampleResponseSchema = z.object({
  runId: z.string(),
  status: z.enum(["passed", "failed", "skipped"]),
  artifacts: z.array(EvidenceArtifactSchema),
  warnings: z.array(z.string()),
});
export type ExampleResponse = z.infer<typeof ExampleResponseSchema>;
```

### 2. Vitest case を追加

`apps/agent/test/sharedSchema.test.ts` (もしくは schema が大きいなら focused test) に:

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

最低限: 有効 minimal payload + 新規 constraint ごとに無効 case 1 つ。

### 3. shared package を build

```bash
pnpm --filter @pwqa/shared build
```

これで `packages/shared/dist/` に `.d.ts` が emit され、下流 workspace が consume する。これをやらないと agent / web は新型を見られない。

### 4. agent で schema を使う

```ts
import { ExampleResponseSchema, type ExampleResponse } from "@pwqa/shared";

router.get("/runs/:runId/example", async (c) => {
  const data = await buildExample(c.req.param("runId"));
  // payload を TS で組み立て、境界で validate:
  const payload: ExampleResponse = data;
  return c.json(ExampleResponseSchema.parse(payload));
});
```

outbound traffic に対する境界での `parse()` は必須 — TS が問題ないと思っていても runtime drift を catch する。

### 5. web で schema を使う

```ts
import { ExampleResponseSchema, type ExampleResponse } from "@pwqa/shared";
import { parseJson } from "./parse-json";

export async function fetchExample(runId: string): Promise<ExampleResponse> {
  const raw = await parseJson(`/api/runs/${runId}/example`);
  return ExampleResponseSchema.parse(raw);
}
```

web client の `.parse()` 呼び出しが、agent 側の bug が React component tree に到達するのを防ぐ。

### 6. typecheck 実行

```bash
pnpm typecheck
```

clean に pass する必要がある。失敗の最も多い原因は `packages/shared/dist/` の stale — step 3 を再実行する。

## 禁止事項

- 同じ payload 型を `apps/agent` と `apps/web` で独立して定義する。home は 1 つ: `packages/shared`。
- 形が分かっている field に `z.unknown()` を当てる。
- 下流コードが新 export に依存しているのに `pnpm --filter @pwqa/shared build` を skip する。
- agent で先に schema を導入し、後で promote する — この非対称性こそが drift の原因。

## 参考パターン

- Status union: `QualityGateProfileSchema`, `RunStatusSchema` — 1 箇所定義、全箇所参照。
- Discriminated union: WS event パターンの reference は `packages/shared/src/index.ts` の `WorkbenchEventSchema`。
- Path field: `FailedTestSchema`、`EvidenceArtifactSchema` の relative/absolute pair。
- 永続化 schema: `RunMetadataSchema`、`QmoSummarySchema` — disk 上のファイル format と API response の両方を担う。

## 関連

- `.agents/rules/schema-first-ja.md` — 本 skill が enforce する rule。
- `.agents/rules/path-safety-ja.md` — path-bearing field 用。
- `.agents/skills/add-agent-route/SKILL-ja.md` — 新 schema を HTTP に通す用。
- `.agents/skills/add-web-feature/SKILL-ja.md` — schema を GUI で consume する用。
