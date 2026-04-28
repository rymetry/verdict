# T202: AllureReportProvider 抽象実装 (Phase 1.2)

## 目的

PLAN.v2 §16 (ReportProvider) の責務分離原則に従い、Phase 1.2 で Allure-formatted run artifacts (`allure-results/*-result.json`) を読み取り、Workbench 共通の `TestResultSummary` に正規化する `AllureReportProvider` を `apps/agent/src/reporting/` に追加する。

T201 (Allure 検証用 fixture) で `tests/fixtures/sample-pw-allure-project/` に allure-playwright + allure CLI を pin 済み。T203 以降の Playwright run pipeline 統合 → T204 HTML 生成 → T205 Quality Gate と前進する Phase 1.2 の最初の **コード実装タスク**。

## スコープ

### 対象

- 新規ファイル: `apps/agent/src/reporting/AllureReportProvider.ts` — provider 実装
- 新規ファイル: `apps/agent/src/reporting/allureResultsReader.ts` — `*-result.json` parser
- 新規ファイル: `apps/agent/test/allureReportProvider.test.ts` — 各種シナリオ
- `apps/agent/test/reportProvider.test.ts` 既存テスト — 影響なし (PlaywrightJsonReportProvider と独立)

### 非対象

- **History 読み取り** (T206) — `<runDir>/allure-results/history.json` 系の trend データは別タスク
- **Quality Gate 結果読み取り** (T205) — `quality-gate-result.json` 永続化と表示は別タスク
- **CSV / log export 読み取り** (T207) — QMO summary 用の補助 artifact は別タスク
- **Run pipeline 統合** (T203) — `runManager.ts` が Allure provider を呼ぶ統合は別タスク
- **HTML report 生成** (T204) — Allure CLI subprocess 起動は別タスク

## アプローチ

### 入力契約

`ReportProvider.readSummary` の既存契約は `{ projectRoot, runDir, playwrightJsonPath }`。`playwrightJsonPath` は Allure では使わないが、interface を変えると PlaywrightJsonReportProvider 側との衝突が起きるので **そのまま残す**。AllureReportProvider は `runDir + "/allure-results"` を **Workbench convention** として固定で読む (PLAN.v2 §22 detect/archive/copy パターンの帰着先)。

```ts
const allureResultsDir = path.join(input.runDir, "allure-results");
```

### Allure 3 result file format

Allure 3 の `allure-results/*-result.json` は以下の shape (公式 docs + `@allurereport/core` の reader 実装で確認):

```jsonc
{
  "uuid": "abc-123",
  "fullName": "tests/example.spec.ts > passes a trivial assertion @smoke",
  "name": "passes a trivial assertion @smoke",
  "status": "passed" | "failed" | "broken" | "skipped" | "unknown",
  "stage": "finished" | "running" | "scheduled",
  "start": 1716000000000,
  "stop": 1716000000123,
  "labels": [{"name": "tag", "value": "smoke"}, ...],
  "links": [],
  "attachments": [
    {"name": "screenshot", "source": "abc-attachment.png", "type": "image/png"}
  ],
  "statusDetails": {"message": "expected 2 to be 3", "trace": "..."}
}
```

加えて container files (`*-container.json`) が fixture / before/after を持つが、Phase 1.2 の summary では使わない (failed test の attachment 紐付けのみ)。

### Status マッピング

Allure status → `TestResultSummary` のフィールド:

| Allure status | Workbench 集計 |
|---|---|
| `passed` | passed +1 |
| `failed` | failed +1 (failedTests に entry 追加) |
| `broken` | failed +1 (test infrastructure error も failed として扱う。PLAN.v2 §27 QMO View で broken を別 surfacing するかは将来検討) |
| `skipped` | skipped +1 |
| `unknown` | warning として記録 (skipped にも failed にも入れない。aggregator query で異常検出) |

### Implementation outline

```ts
// allureResultsReader.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";

const AllureResultSchema = z.object({
  uuid: z.string(),
  fullName: z.string().optional(),
  name: z.string().optional(),
  status: z.enum(["passed", "failed", "broken", "skipped", "unknown"]),
  stage: z.string().optional(),
  start: z.number().optional(),
  stop: z.number().optional(),
  labels: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  attachments: z.array(z.object({
    name: z.string(),
    source: z.string(),
    type: z.string().optional()
  })).default([]),
  statusDetails: z.object({
    message: z.string().optional(),
    trace: z.string().optional()
  }).optional()
});

export type AllureResult = z.infer<typeof AllureResultSchema>;

export async function readAllureResults(allureResultsDir: string): Promise<{
  results: AllureResult[];
  warnings: string[];
}> {
  // 1. Read directory entries
  // 2. Filter for *-result.json
  // 3. Parse each with zod, accumulate warnings on parse failure
  // 4. Return results + warnings
}
```

```ts
// AllureReportProvider.ts
import * as path from "node:path";
import { readAllureResults } from "./allureResultsReader.js";
import type { ReadSummaryResult, ReportProvider, ReportProviderInput } from "./ReportProvider.js";

export const allureReportProvider: ReportProvider = {
  name: "allure",
  async readSummary(input: ReportProviderInput): Promise<ReadSummaryResult | undefined> {
    const allureResultsDir = path.join(input.runDir, "allure-results");
    const { results, warnings } = await readAllureResults(allureResultsDir);
    if (results.length === 0 && warnings.length === 0) return undefined; // 空ディレクトリ = 結果なし
    
    // Aggregate
    let passed = 0, failed = 0, skipped = 0;
    const failedTests = [];
    for (const r of results) {
      switch (r.status) {
        case "passed": passed++; break;
        case "failed":
        case "broken":
          failed++;
          failedTests.push(toFailedTest(r, input.projectRoot));
          break;
        case "skipped": skipped++; break;
        case "unknown":
          warnings.push(`Allure result ${r.uuid} has status "unknown"; not counted as pass/fail`);
          break;
      }
    }
    
    return {
      summary: {
        total: passed + failed + skipped,
        passed, failed, skipped,
        flaky: 0, // Allure 3 単一 run では flaky 判定不可 (history 必要 — T206)
        durationMs: ..., // start/stop の diff 集約
        failedTests
      },
      warnings
    };
  }
};
```

### エラー処理

- 空ディレクトリ: `undefined` を返す (既存契約に従う)
- ENOENT: throw (PlaywrightJsonReportProvider と同じ振る舞い。caller がログを担当)
- 1 つの result file が parse 失敗: warning に追加、他のファイルは継続処理 (best-effort)
- 全部 parse 失敗: empty summary + warnings (Workbench 側で「Allure parse 全滅」を検知できる形)

### Path leakage 防止

PLAN.v2 §28 / Issue #27 で確立した path-redaction policy に従う:
- `failedTest.filePath` は projectRoot 配下に正規化 (relative path 化はしない、絶対 path をそのまま入れる — 既存 PlaywrightJsonReportProvider と同じ振る舞い)
- ファイル parse 失敗時の warning には **filename だけ** 含め、絶対 path は出さない (`<runDir>` は user の workspace に既知だが、意図せず logger に渡される事故を防ぐ)
- structured logger 連携は本タスクでは追加しない (T203 の run pipeline 統合で `artifactKind: "allure-results"` 識別子追加と合わせて行う — Issue #31 で確立した axes に従い `op: "summary-extract"` で識別)

## 検討した代替案

- **A. `@allurereport/core` の Programmatic API を使う** — `import { AllureReport } from "@allurereport/core"` で reader と aggregation を委譲できる。**非採用**: `@allurereport/core@3.6.2` は preact 10 を transitive に持ち (Allure UI が preact 製)、Workbench の Node-only agent が UI deps を依存に持つことになる。zod + 自前 parse のほうが boundary が clean
- **B. provider interface を改造して `allureResultsDir` を required input にする** — discriminated union や optional field 化。**非採用**: PlaywrightJsonReportProvider との対称性を壊す。Workbench convention (`runDir + "/allure-results"`) で十分
- **C. 単一 result.json を期待する (allure CLI の出力前提)** — Allure CLI generate の出力 (`<reportDir>/data/test-cases/*.json`) を読む。**非採用**: それは T204 (HTML report 生成) が走った後の output。T202 は raw `allure-results/` (生 reporter 出力) を読む方が、より早い段階の summary が取れる + CLI 起動を後段 task に分離できる

## 影響範囲

- 新規ファイル 3 つ (provider, reader, test)
- 既存ファイル変更なし
- `apps/agent/package.json` に zod は既に依存あり (PR #2 / Phase 1 で導入済み)。追加 dep なし
- public API 影響なし

## テスト方針

`apps/agent/test/allureReportProvider.test.ts` で以下シナリオ:

1. **空ディレクトリ**: `undefined` を返す
2. **存在しないディレクトリ (ENOENT)**: throw
3. **1 件 passing only**: passed=1, failed=0, skipped=0, total=1, failedTests=[]
4. **1 件 passing + 1 件 failing**: passed=1, failed=1, total=2, failedTests=[1 entry]
5. **broken status**: failed counter に集計 (1 broken → failed=1)
6. **skipped status**: skipped counter に集計
7. **unknown status**: counter にも failedTests にも入らない、warning に追加
8. **不正 JSON (パース失敗)**: そのファイルだけ warning、他は処理継続
9. **JSON でも schema 不一致 (zod fail)**: そのファイルだけ warning、他は処理継続
10. **failedTest.filePath に絶対 path を含める** (既存 PlaywrightJsonReportProvider と挙動一致)
11. **projectRoot 配下を logger に漏らさない**: warning に絶対 path を含めない

テストデータ: `mkdtemp` で一時ディレクトリ作成 → `*-result.json` を fs.writeFile で作成。各 case で 1〜数ファイル。

## リスクと緩和策

- **リスク**: Allure 3 result file の schema が Allure 公式 docs と微妙に違う (T200 メモ訂正で confirmed: docs と CLI 実態が乖離している)
  - **緩和**: zod schema を少しゆるく定義 (`.passthrough()` や optional field 多め) し、pred-known fields のみ厳格 parse。実際の allure-playwright 出力は T204 で実機確認できるので、必要なら schema 微調整
- **リスク**: 大量 result file (e.g. 1000 tests) で メモリ食う
  - **緩和**: PoC 想定規模 (数十 tests) では問題なし。Phase 5+ で scale 検討
- **リスク**: failed と broken の集計境界が QMO ビューで誤解される
  - **緩和**: `TestResultSummary` への集計は failed に統合するが、warnings に「broken: N tests had infrastructure-level failure」と付記。QMO View で別 surface する判断は Phase 5 以降

## 想定外の判断ポイント

- attachments は本タスクでは **failedTest.attachments に正規化しない**。理由: Allure attachment は path だけでなく content (画像 base64 や JSON) で渡されるケースがあり、redaction policy / artifact viewer (Phase 5) との連携を要する。T202 では metadata のみ。Phase 1.2 後段または Phase 5 で TestAttachment への正規化を別途実装
- step / fixture (before/after) も本タスクでは無視。failed test の root cause 解析に使うが、Phase 5 (QA View / Failure Review) のスコープ

## 失敗カウンタ

- phase_4_5_failure_count: 0
- pr_merge_failure_count: 0
