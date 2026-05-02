---
name: add-agent-route
description: `apps/agent` に新規のサーバーサイド HTTP route または WebSocket event を追加するときに使う (Hono)。新しい payload を伴う場合は `add-shared-schema` の後に実行すること。Router 配線、request/response validation、error マッピング、audit log、route に対する test をカバーする。ブラウザ側 route は対象外 — `apps/web` の routing は `add-web-feature` を参照。
---

# Agent に HTTP / WebSocket route を追加する

> EN: [`SKILL.md`](SKILL.md) (英語版が SoT、本書は理解補助)

Verdict の agent は `@hono/node-server` 上の Hono を使用。WebSocket は `@hono/node-ws` 経由で `/ws` に配置。Route は domain 別に `apps/agent/src/routes/` 配下で組織化され、`apps/agent/src/server.ts` で register される。

## いつ使うか

- 新 feature が HTTP endpoint を必要とする (REST 形、JSON in/out)。
- 新 WS event 型を GUI に broadcast する必要がある。
- 既存 route の input / output shape が変わる。

## Pre-flight

1. **Schema first.** `.agents/skills/add-shared-schema/SKILL-ja.md` を読む。route の request / response 型は `packages/shared` 由来でなければならない。schema を commit して `pnpm --filter @pwqa/shared build` を走らせるまで route 実装を始めない。
2. **No-shell.** route が subprocess を trigger するなら `CommandRunner` 経由。`.agents/rules/no-shell-ja.md` 参照。
3. **Path safety.** response で path を返す場合は project-relative。`.agents/rules/path-safety-ja.md` 参照。

## 手順

### 1. 適切な router ファイルを選ぶ

domain 分割 (現状の規約):

| ファイル | domain |
|---|---|
| `apps/agent/src/routes/projects.ts` | Project open / current / config summary |
| `apps/agent/src/routes/runs.ts` | Run lifecycle、artifact、AI、repair |
| `apps/agent/src/routes/health.ts` | Health、version |

route が上記いずれにも属さない場合、新ファイル (例: `qmo.ts`) を作って `server.ts` から import する。

### 2. route を追加

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

規約:
- entry で request body を `Schema.parse(await c.req.json())` で validate。
- exit で response を `Schema.parse(payload)` で validate。
- 4xx error: typed error を throw (もしくは `apiError(c, code, message, status)`); unhandled exception を escape させない。
- 5xx error: `pino` で `errorLogFields(error)` 付き log; client には stable `code` を返す (例: `RUN_NOT_FOUND`、`AI_CLI_FAILED`)。raw stack を user に見せない。

### 3. Subprocess (該当時)

route が subprocess を起動する場合:

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

failure mode を明示的に handle:
- `result.timedOut` → 構造化された timeout payload を返す (暗黙 retry しない)。
- `result.cancelled` → `cancelled` event を emit; error 扱いしない。
- `result.exitCode !== 0` → 既存パターンに従って分類 (`apps/agent/src/ai/cliAdapter.ts:classifyNonZeroExit`)。

### 4. WebSocket event

event は `apps/agent/src/events/` の既存 dispatcher 経由。新 event 型を追加するには:

1. `packages/shared/src/index.ts` の `WorkbenchEventSchema` に discriminant を追加。
2. payload schema を定義し union に merge。
3. agent コード内から `eventBus.publish({ type: "...", runId, sequence, timestamp, payload })` を呼ぶ。
4. WS frontend は既存 `EventStream` 抽象経由で読む。既知 shape の variant が新増えるだけなら plumbing 変更不要。

sequence 番号は bus が発行する。**自前で invent しない**。再接続 client は sequence で dedup / 再 pull する。

### 5. Audit log

すべての subprocess invocation は runner 経由で audit-log entry を auto emit。状態を mutate する非 subprocess route (例: patch を apply、config を persist) では、audit trail が再現可能になるよう構造化フィールド付きの明示 `logger.info(..., "operation summary")` を追加する。

### 6. テスト

route あたり最低 3 つの test を書く:

1. **Happy path** — 有効入力、有効出力、両側で schema が parse する。
2. **Validation rejection** — 無効 request body が stable code 付き 400 を返す。
3. **Failure mode** — 最も起こりやすい upstream 失敗 (subprocess timeout、ファイル not found、repository dirty) が secret/path leak なしに正しい code を返す。

test ファイル位置: `apps/agent/test/<domain>.test.ts` (例: `runs.test.ts`)。

ファイルシステム依存の route は、`apps/agent/test/runManager.test.ts` で確立された `tmpdir`-rooted fixture を使う。

## 禁止事項

- exit 時に schema validate せずに response object を hand-type する。
- `Schema.parse` なしの `unknown` payload に `c.json(...)`。
- `try {} catch {}` や `.catch(() => undefined)` でエラーを swallow する。typed wrapper か rethrow。
- timeout / cancellation 処理なしに `runManager.startRun` (他長時間 operation) を呼ぶ。
- raw `error.stack` を client に返す。

## レビュアーチェックリスト

- [ ] Request と response の両方が境界で Zod-parse されているか。
- [ ] error response が stable string code を使っているか (UUID 不可、英語 only メッセージ不可)。
- [ ] subprocess path が `CommandRunner` を経由しているか。
- [ ] path-bearing field が project-relative か。
- [ ] test が happy path + validation 1 つ + failure mode 1 つをカバーしているか。
- [ ] WS event payload が `packages/shared` の discriminated union schema にマッチしているか。

## 関連

- `.agents/skills/add-shared-schema/SKILL-ja.md` — 前提 step。
- `.agents/rules/no-shell-ja.md` — subprocess 制約。
- `.agents/rules/path-safety-ja.md` — path 正規化。
- `.agents/rules/secret-handling-ja.md` — env / log 規律。
- `apps/agent/src/routes/runs.ts` — 最も発展した reference; パターンを踏襲する。
