# RFC 0001: `.workbench/` Directory Specification & Multi-Stage AI Pipeline

| Field | Value |
|---|---|
| Status | Draft |
| Authors | Workbench team |
| Created | 2026-05 |
| Target | Phase 1.5 完了 |
| Supersedes | — |
| Related | [PRODUCT.md](../PRODUCT.md), [PLAN.v3.md](../PLAN.v3.md), PLAN.v2 §11 / §16 / §29 |

---

## 1. Motivation

PLAN.v2 で実装した Phase 1 の AI 機能 (T1100 系 AI Test Generation、T500 系 AI Analysis) は **single-shot** 設計だった:

```
[user 自然言語] → [LLM 1 回呼び出し] → [Playwright code]
```

この設計は以下の限界を持つ:

1. **複雑 multi-step UI で迷子**: AI が画面を知らずに code を書くため、locator も flow も推測ベース
2. **drift**: UI 変更で test が壊れた時、AI が rule なしに「適当に」直すため、test 品質が劣化していく
3. **trust gap**: 規制業界は「AI が独断で生成した code」を audit 不能として拒絶する
4. **民主化阻害**: 生成物が code のみで、PM/QA が中間 artifact を読めない

これに対し、PRODUCT.md §7 で示した **多段 AI pipeline + `.workbench/` guardrail** は:

```
[explore UI] → [comprehend] → [judge layer] → [Test Plan] → [clarify] → [generate code] → [review]
                                  ↑                    ↑
                          .workbench/rules/    .workbench/skills/
                          .workbench/AGENTS.md
                          .workbench/hooks/
```

各 step で **rule / skill / hook が AI を導く + 中間 artifact が human-readable**。これは Cursor / Claude Code が product code で確立したパターンを test 領域へ転写する設計。

本 RFC はその技術仕様を定める。

## 2. Goals & Non-goals

### Goals

- `.workbench/` directory 構造を確定し、project 内に versionable な test 知識基盤を置く
- AGENTS.md / skills / rules / hooks / intents / prompts の各文法を定義
- 多段 AI pipeline 7 phase の input / output schema を定める
- 既存 Phase 1 component (CommandRunner / AI Adapter / Repair Review / Quality Gate) の再利用境界を明示
- design partner / Codex 等が自走できる解像度の仕様にする

### Non-goals

- 探索 engine の実装詳細 (Phase 1.5-β で別 RFC)
- Server 製品の API / DB schema (Phase 3 で別 RFC)
- Quality Signal Bus 抽象 (Phase 2 で別 RFC)
- 具体的な prompt 文言 (実装時に固定; Phase 1.5-α 着手時に prompt RFC を別途)
- UI mockup (`docs/design/concept-b-refined.html` 系の配下で別管理)

---

## 3. `.workbench/` Directory Structure

`<project-root>/.workbench/` に配置する。Git 管理対象。

```
.workbench/
├── AGENTS.md                       # project 全体の AI context
├── skills/
│   ├── payment-flow.md             # 決済 test の reusable pattern
│   ├── auth-flow.md                # 認証 flow
│   ├── admin-action.md             # 管理者操作の検証 pattern
│   └── data-cleanup.md             # 後始末
├── rules/
│   ├── locator-policy.md           # data-testid > role > text、xpath 禁止 等
│   ├── wait-policy.md              # arbitrary sleep 禁止、明示 wait のみ
│   ├── network-policy.md           # 外部 API は MSW で mock
│   ├── data-policy.md              # production data 禁止、fixture のみ
│   ├── naming-convention.md        # spec ファイル命名、test 命名
│   └── coverage-policy.md          # 必須カバー領域
├── hooks/
│   ├── pre-explore.sh              # 探索前 (環境準備)
│   ├── pre-generate.sh             # 生成前 (context 検証)
│   ├── post-generate.sh            # 生成後 (lint / type / forbidden pattern check)
│   └── pre-merge.sh                # PR merge 前 (Quality Gate)
├── intents/
│   ├── checkout-with-saved-card.md # PM が書いた intent (永続)
│   └── password-reset.md
├── prompts/
│   ├── explore.md                  # 探索 phase の master prompt
│   ├── comprehend.md               # 理解 phase
│   ├── layer-judgment.md           # layer 判断 phase
│   ├── plan.md                     # Plan 生成 phase
│   ├── clarify.md                  # 会話 phase
│   ├── generate.md                 # code 生成 phase
│   └── triage-failure.md           # 失敗トリアージ (既存 T500 流用)
├── packs/                          # community rule/skill pack の install 先
│   └── nextjs-rules-1.0.0/         # 例: `@workbench/nextjs-rules`
└── workbench.json                  # `.workbench/` 自体のバージョン / 設定
```

### 3.1 `workbench.json`

```json
{
  "version": "0.1",
  "explorationEngine": "stagehand",
  "aiAdapter": "claude-code",
  "rulePacks": ["@workbench/nextjs-rules@1.0.0"],
  "skillPacks": [],
  "outputDirs": {
    "tests": "tests",
    "fixtures": "tests/fixtures"
  }
}
```

### 3.2 `AGENTS.md`

Project 全体の AI context。**現在の Cursor `.cursorrules` / Claude Code `CLAUDE.md` と同等の役割**。

例:

```markdown
# Project AI Context

## What this project does
SaaS for managing freelance contracts. Next.js 14 + Stripe + PostgreSQL.

## Critical user flows
1. Sign up & email verification
2. Project creation
3. Contract drafting & signing (DocuSign API)
4. Invoice & payment (Stripe)
5. Admin user management

## Don'ts (project-wide)
- Never call real Stripe API in tests; always use Stripe test fixtures
- Never write to production database; tests run against `test_db_*` schemas
- Never use `await page.waitForTimeout()`; always explicit waits

## Testing conventions
- Use `data-testid` as primary locator
- Spec naming: `<feature>-<scenario>.spec.ts`
- Test naming: `should <behavior>` (English)
- Each spec has its own `test.beforeEach` for isolation

## Skills available
- `payment-flow` for Stripe-related tests
- `auth-flow` for sign in / sign up / password reset
- `admin-action` for admin operations

## Glossary
- "Project" = customer-facing freelance project (not "test project")
- "Contract" = legal contract between contractor and client
```

### 3.3 `skills/<name>.md`

再利用可能な test pattern。**1 skill = 1 つの flow knowledge**。

例: `skills/payment-flow.md`

```markdown
# Skill: Payment Flow

## When to use
- Tests that involve Stripe Checkout, saved cards, or recurring billing.

## Required setup
- Test user must be created with `seedUser({ stripeCustomerId: 'cus_test_xxx' })`
- Stripe test cards:
  - `4242 4242 4242 4242` (success)
  - `4000 0000 0000 9995` (insufficient funds)
  - `4000 0027 6000 3184` (3DS required)

## Standard flow steps
1. Login as test user
2. Add item(s) to cart with known prices
3. Navigate to /checkout
4. Select payment method (saved card or new)
5. Click "Pay" button (testid: `checkout-pay-button`)
6. For 3DS: handle modal (testid: `stripe-3ds-frame`)
7. Wait for redirect to /orders/<id>
8. Assert: order status === "paid", correct amount, items match

## Locator hints
- Cart items: `[data-testid^="cart-item-"]`
- Total amount: `[data-testid="cart-total"]`
- Pay button: `[data-testid="checkout-pay-button"]`

## Common pitfalls
- Stripe webhook is async; always `await page.waitForURL(/\/orders\//)`
- Don't assume order id; capture from URL
- Currency formatting: `$10.00` not `$10` (en-US)

## Anti-patterns (forbidden in this project)
- Calling Stripe REST API directly in tests
- Hardcoded order ids
- Fixed sleeps for webhook completion
```

### 3.4 `rules/<name>.md`

**強制ルール**。post-generate hook で違反をブロック。

例: `rules/locator-policy.md`

```markdown
# Rule: Locator Policy

## Priority order (must follow)
1. `[data-testid="..."]` — preferred
2. `getByRole(role, { name })` — when accessibility-stable
3. `getByText(...)` — only for static text
4. `getByLabel(...)` — for form fields

## Forbidden
- `xpath=...` — never
- `[class="..."]` — class-based selection
- `nth-child(n)` — positional

## Rationale
Class names and DOM positions change with refactors; testid and role are intentional contracts.

## Hook check
`post-generate.sh` greps for forbidden patterns and rejects.
```

### 3.5 `hooks/<phase>.sh`

各 phase 前後の検証 / 加工。**標準入出力で AI と通信**:
- stdin: phase の output (JSON)
- stdout: 加工後 output、または `{"ok":false,"errors":[...]}` で reject
- exit code: 0 = ok, 非0 = block

例: `hooks/post-generate.sh`

```bash
#!/bin/bash
set -euo pipefail

generated_file="$1"

# Rule check 1: data-testid 使用必須
if grep -q "page.locator(.xpath=" "$generated_file"; then
  echo '{"ok":false,"errors":["xpath locator detected — see rules/locator-policy.md"]}'
  exit 1
fi

# Rule check 2: arbitrary sleep 禁止
if grep -q "waitForTimeout" "$generated_file"; then
  echo '{"ok":false,"errors":["waitForTimeout detected — use explicit waits"]}'
  exit 1
fi

# TypeScript check
pnpm typecheck "$generated_file" || exit 1

echo '{"ok":true}'
```

### 3.6 `intents/<name>.md`

PM / QA / Domain expert が書く **test の目的**。永続化される source-of-truth。

例: `intents/checkout-with-saved-card.md`

```markdown
# Intent: Checkout with Saved Card

## Plain language
A user with a previously saved credit card should be able to complete checkout
in 3 clicks or fewer, without re-entering card details.

## Why this matters
- Reduces friction at the highest-value moment of the funnel
- Conversion rate target: 65% checkout completion among saved-card users
- Last incident: 2026-03 saved-card flow broke after Stripe API upgrade

## Out of scope
- New card entry (covered in `checkout-with-new-card`)
- 3DS handling (covered in `checkout-with-3ds-card`)
- Subscription products (covered in `subscription-checkout`)

## Acceptance examples
- Given a logged-in user with one saved card,
  When they add a $10 item to cart and click "Pay with saved card",
  Then the order should be created with status "paid" and amount $10.

- Given a logged-in user with two saved cards,
  When they add an item and select the second card,
  Then the second card should be charged.

## Data requirements
- Test user fixture: `users.with_saved_card`
- Test items: `items.standard_10usd`

## Last updated
2026-05-01 by @pm-alice
```

### 3.7 `prompts/<phase>.md`

各 phase の master prompt template。実装で固定。**design partner には公開しないが OSS 化候補**。

---

## 4. Multi-Stage AI Pipeline 詳細

### 4.1 Phase A: 探索 (Explore)

**Input**:
- `intents/<name>.md` (どこを探索するか)
- `AGENTS.md` (project context)
- `workbench.json` (engine 選択)

**Process**:
- Stagehand / Browser Use adapter で実 UI を駆動
- `intent.acceptance examples` を駆動目標として使用
- 探索中の各 step で DOM snapshot / network log を capture
- 不明点は **Phase E (clarify) を invoke**

**Output**: `Screen Model` (JSON, 永続化先 `.playwright-workbench/runs/<runId>/exploration.json`)

```typescript
type ScreenModel = {
  startUrl: string;
  steps: ExploredStep[];
  observedFlows: ObservedFlow[];
  unclear: ClarificationRequest[];
};

type ExploredStep = {
  stepId: string;
  action: "navigate" | "click" | "fill" | "select" | "wait" | "observe";
  target?: { selector: string; testid?: string; role?: string; text?: string };
  data?: unknown;
  domSnapshot: string;       // simplified DOM
  networkCalls: NetworkCall[];
  timestamp: string;
};

type ObservedFlow = {
  flowId: string;
  description: string;       // LLM-generated
  stepIds: string[];
  triggers: string[];        // user actions that initiate
  outcomes: string[];        // observed end states
};

type ClarificationRequest = {
  questionId: string;
  question: string;
  context: string;
  optionsHint?: string[];
};
```

### 4.2 Phase B: 理解 (Comprehend)

**Input**: `Screen Model` (Phase A output)

**Process**:
- LLM が screen model を読み、business semantic を注釈
- "この form は payment 入力" 等の意味付け
- 既存 spec との照合 (重複検出)

**Output**: `AnnotatedScreenModel` — Phase A output + semantic 注釈

### 4.3 Phase C: Layer 判断 (Layer Judgment)

**Input**: `AnnotatedScreenModel`, `AGENTS.md`, 既存 test inventory

**Process**:
- 各 observedFlow について、test 適切 layer を AI 判断
- 判断基準:
  - **unit**: pure logic, no I/O
  - **integration**: 1 component + DB / API stub
  - **contract**: API contract 検証
  - **E2E**: user flow 全体
  - **manual**: AI 自動化困難 (UX 主観 / 視覚 / 実機固有)
  - **none-needed**: 既存 test で carbon ある / 重要度低

**Output**: `LayerJudgment[]`

```typescript
type LayerJudgment = {
  flowId: string;
  recommended: "unit" | "integration" | "contract" | "e2e" | "manual" | "none-needed";
  confidence: number;        // 0-1
  rationale: string;
  alternativeLayers?: string[];
  riskIfWrong: "low" | "medium" | "high";
};
```

### 4.4 Phase D: Test Plan 生成 (Plan)

**Input**: `AnnotatedScreenModel`, `LayerJudgment[]` (recommended === "e2e" のみ), `intents/<name>.md`, `skills/<name>.md` (関連)

**Process**:
- 1 plan = 1 spec ファイル想定
- skill を参照して step pattern を埋め込む
- risk / coverage 注釈

**Output**: `TestPlan` (Markdown, 永続化先 `.workbench/intents/<name>.plan.md`)

```markdown
# Test Plan: checkout-with-saved-card

## Intent (PM)
A user with a previously saved credit card should complete checkout in 3 clicks.

## Layer Decision
- Primary: E2E (UI through Stripe sandbox)
- Adjunct: unit test for `CardSelector` component (covered separately)
- Excluded: integration (E2E covers it sufficiently)

## Risks
- High: amount recalculation when switching cards (incident in 2026-03)
- Medium: 3DS redirect-back behavior
- Low: validation error display

## Steps (AI explored)
1. Login as `users.with_saved_card`
2. Navigate to /cart with $10 item
3. Click "Pay with saved card"
4. Verify modal shows correct amount
5. Click "Confirm"
6. Wait for Stripe webhook completion
7. Verify order in /orders/{id} status="paid"

## Skills used
- `payment-flow.md` (steps 5-7)
- `auth-flow.md` (step 1)

## Open Questions (AI → human)
- Q1: Should this test cover the 3DS-required-card scenario?
- Q2: When the sandbox returns amount mismatch, how many retries are expected?

## Coverage Notes
- Cart amount logic: unit test recommended (out of scope for this plan)
- Stripe webhook signature verification: contract test (out of scope)

## Generated by
Workbench v0.1.0 / claude-code adapter / 2026-05-01T12:34:56Z
```

### 4.5 Phase E: 会話で曖昧解消 (Clarify)

**Input**: 任意の phase からの `ClarificationRequest[]`

**Process**:
- Workbench UI で inline 質問表示
- user 回答 → AI が phase output 更新
- 回答は `intents/<name>.md` に追記永続化 (次回探索で引き継ぎ)

**UI design** (Phase 1.5-γ で実装):
- 同期 modal (default): test plan review 中に inline
- 非同期 thread (option): Slack 連携時に slack thread

### 4.6 Phase F: Code 生成 (Generate)

**Input**: `TestPlan`, `AGENTS.md`, `rules/*.md` 全件, `skills/*.md` (TestPlan が参照したもの)

**Process**:
- 既存 T1100 (AI Test Generation) を rule/skill 注入で強化
- prompt template: `prompts/generate.md` を使用
- LLM 生成 → `pre-generate.sh` hook で context 検証
- LLM 生成 (本番) → `post-generate.sh` hook で rule 違反 check
- 違反検出 → AI に修正 prompt (max 3 retry)

**Output**: Playwright TypeScript spec ファイル

### 4.7 Phase G: Repair Review

**Input**: 生成された spec ファイル (diff 形式)

**Process**:
- 既存 Phase 1 の Repair Review flow をそのまま使用 (PLAN.v2 §25)
- `git apply --check` → temporary apply → run → compare → approve / reject
- approve なら PR 作成 (既存 T1000 系流用)

**Output**: GitHub PR

---

## 5. 既存 Workbench architecture との統合

既存 component の再利用境界:

| 既存 component | Phase 1.5 での役割 | 拡張要否 |
|---|---|---|
| `CommandRunner` (PLAN.v2 §14) | hook 実行 (`pre-explore.sh` 等) | 拡張不要、既存 policy で動く |
| `AI Adapter` (PLAN.v2 §26, T500) | Phase B/C/D/F の LLM 呼び出し | 拡張: prompt template 注入, multi-turn 対応 |
| `Project Scanner` (PLAN.v2 §13) | `.workbench/` 検出 | 拡張: workbench.json parser |
| `Repair Review` (PLAN.v2 §25, T600) | Phase G | そのまま流用 |
| `Quality Gate` (PLAN.v2 §23) | Phase G の判定 | そのまま流用 |
| `Audit Log` | hook / pipeline 全 step を記録 | 拡張: pipeline 専用 audit category |
| `Allure pipeline` (PLAN.v2 §22) | 生成 test の実行結果評価 | そのまま流用 |
| `Failure Review` (T300) | drift 修正 flow (Phase F → 失敗 → Phase A 再探索) | 拡張: Phase A invoke trigger |
| Web UI | Test Plan review UI 追加 | 拡張: `features/test-plan-review/` |

新規 component:

| 新規 component | 所在 |
|---|---|
| `WorkbenchLoader` (.workbench/ parser) | `apps/agent/src/workbench/loader.ts` |
| `ExplorationEngine` (Stagehand wrapper) | `apps/agent/src/exploration/engine.ts` |
| `LayerJudgment` (LLM-driven) | `apps/agent/src/ai/layerJudgment.ts` |
| `TestPlanGenerator` | `apps/agent/src/ai/testPlan.ts` |
| `TestPlanReviewPanel` (UI) | `apps/web/src/features/test-plan-review/` |
| `ConversationalClarifier` | UI + agent 両側 |

---

## 6. Versioning & Migration

### 6.1 `.workbench/` バージョニング

`workbench.json` の `version` field で管理。**0.1 から開始**、breaking change ごとに minor 上げ。

| version | 変更 |
|---|---|
| 0.1 | 初版 (本 RFC) |
| 0.2 (予定) | Phase 2 の Quality Signal 統合時 |
| 1.0 (Phase 3 後) | API 安定宣言 |

migration tool (`workbench migrate`) を提供する (Phase 1.5-δ)。

### 6.2 既存 project への adoption

```bash
# Workbench Agent CLI で初期化
npx playwright-workbench init
# → .workbench/ skeleton + sample AGENTS.md / rules / skills を生成
# → .gitignore 提案
# → 既存 spec を読んで rule violation を検出
```

---

## 7. Security Considerations

| 領域 | 対策 |
|---|---|
| `.workbench/` 内に secret が混入 | hooks に `pre-commit` style scanner 同梱 (gitleaks 流) |
| hook script の任意実行 | hook は `.workbench/hooks/` 配下のみ許可、CommandRunner policy で制限 |
| LLM 生成 code の有害 pattern | post-generate hook で forbidden pattern 検出 |
| 探索時の認証情報露出 | exploration adapter に redaction layer (storageState / cookie 値を log しない) |
| user の API key | customer 持ち込みを推奨、Workbench は永続化しない (env 経由のみ) |
| audit trail | 全 phase の input / output を audit.log に記録 (改竄不可化は Phase 3 Server で) |

---

## 8. Open Questions

| # | 質問 | 解消予定 |
|---|---|---|
| OQ-A | Test Plan の中間 schema は markdown のみで足りるか、structured JSON も併用すべきか | Phase 1.5-α 末: design partner FB |
| OQ-B | rule pack registry は npm か独自 (`workbench install`) か | Phase 1.5-δ |
| OQ-C | hook scripts の言語制約 (bash のみ vs node script 許可) | Phase 1.5-α |
| OQ-D | Stagehand vs Browser Use vs 自社 wrapper の primary 選定 | Phase 1.5-β 末: 評価データセットで判定 |
| OQ-E | Conversation UI は modal か thread か | Phase 1.5-γ design partner FB |
| OQ-F | `intents/` を生成時に AI が更新するか (回答永続化) | 本 RFC で yes 確定、ただし 確認 UI 経由 |
| OQ-G | Phase A〜D の中間 artifact の保存先 (run-scoped か `.workbench/cache/` か) | Phase 1.5-α |
| OQ-H | community rule pack の品質保証 (review process 等) | Phase 1.5-δ |

---

## 9. Examples

完全な例は [`test-plan-samples/`](../test-plan-samples/) 参照:

- [`checkout-with-saved-card.md`](../test-plan-samples/checkout-with-saved-card.md)
- [`password-reset.md`](../test-plan-samples/password-reset.md)
- [`admin-user-suspend.md`](../test-plan-samples/admin-user-suspend.md)

---

## 10. References

- [PRODUCT.md](../PRODUCT.md) §7 — 多段 pipeline の概念図
- [PLAN.v3.md](../PLAN.v3.md) §2 — Phase 1.5 タスク分解
- [PLAN.v2.md](../../../PLAN.v2.md) §14 — CommandRunner Design (再利用)
- [PLAN.v2.md](../../../PLAN.v2.md) §26 — AI Adapter Design (再利用)
- Cursor `.cursorrules` documentation
- Anthropic Claude Code `CLAUDE.md` documentation
- Stagehand documentation (https://docs.stagehand.dev/)
- Browser Use repository (https://github.com/browser-use/browser-use)

---

## 11. Revision history

- **v0.1** (2026-05): 初版。`.workbench/` 構造と多段 pipeline 7 phase の I/O schema を定義。
