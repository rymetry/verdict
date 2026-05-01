# RFC 0001: `.workbench/` Directory Specification & Multi-Stage AI Pipeline

| Field | Value |
|---|---|
| Status | Draft |
| Authors | Workbench team |
| Created | 2026-05 |
| Target | End of Phase 1.5 |
| Supersedes | — |
| Related | [PRODUCT.en.md](../PRODUCT.en.md), [PLAN.v3.en.md](../PLAN.v3.en.md), PLAN.v2 §11 / §16 / §29 |

---

## 1. Motivation

Phase 1 AI features in PLAN.v2 (T1100 series AI Test Generation, T500 series AI Analysis) were designed as **single-shot**:

```
[user natural language] → [single LLM call] → [Playwright code]
```

This design has known limits:

1. **Lost in complex multi-step UIs**: AI writes code without seeing the screen, so locators and flows are guesswork.
2. **Drift**: When UI changes break tests, AI without rules "fixes" them ad hoc, degrading test quality over time.
3. **Trust gap**: Regulated industries reject "AI-generated, audit-opaque" code.
4. **Anti-democratization**: The output is code only — PMs / QAs cannot read intermediate artifacts.

PRODUCT §7's **multi-stage AI pipeline + `.workbench/` guardrail** addresses these:

```
[explore UI] → [comprehend] → [judge layer] → [Test Plan] → [clarify] → [generate code] → [review]
                                    ↑                  ↑
                          .workbench/rules/    .workbench/skills/
                          .workbench/AGENTS.md
                          .workbench/hooks/
```

Each step has **rules / skills / hooks guiding AI** plus **human-readable intermediate artifacts**. This transposes the pattern Cursor / Claude Code established for product code into the testing domain.

This RFC defines the technical specification.

## 2. Goals & Non-goals

### Goals

- Finalize the `.workbench/` directory layout as a versionable test-knowledge base in each project.
- Define grammar for AGENTS.md, skills, rules, hooks, intents, and prompts.
- Specify input / output schemas for the seven phases of the AI pipeline.
- Make explicit the reuse boundaries with existing Phase 1 components (CommandRunner / AI Adapter / Repair Review / Quality Gate).
- Document at a fidelity that lets design partners and Codex execute without ambiguity.

### Non-goals

- Implementation details of the exploration engine (separate RFC in Phase 1.5-β).
- Server product API / DB schema (separate RFC in Phase 3).
- Quality Signal Bus abstraction (separate RFC in Phase 2).
- Concrete prompt wording (a separate prompt RFC at Phase 1.5-α kickoff).
- UI mockups (`docs/design/concept-b-refined.html` family is managed there).

---

## 3. `.workbench/` Directory Structure

Located at `<project-root>/.workbench/`. Versioned in Git.

```
.workbench/
├── AGENTS.md                       # Project-wide AI context
├── skills/
│   ├── payment-flow.md             # Reusable pattern for payment tests
│   ├── auth-flow.md                # Authentication flows
│   ├── admin-action.md             # Admin operation verification pattern
│   └── data-cleanup.md             # Cleanup
├── rules/
│   ├── locator-policy.md           # data-testid > role > text, no xpath
│   ├── wait-policy.md              # No arbitrary sleep, explicit waits only
│   ├── network-policy.md           # External APIs mocked via MSW
│   ├── data-policy.md              # No production data, fixtures only
│   ├── naming-convention.md        # Spec / test naming
│   └── coverage-policy.md          # Required coverage areas
├── hooks/
│   ├── pre-explore.sh              # Before exploration (env preparation)
│   ├── pre-generate.sh             # Before generation (context check)
│   ├── post-generate.sh            # After generation (lint / type / forbidden pattern)
│   └── pre-merge.sh                # Before PR merge (Quality Gate)
├── intents/
│   ├── checkout-with-saved-card.md # Intent written by PM (persistent)
│   └── password-reset.md
├── prompts/
│   ├── explore.md                  # Master prompt for exploration
│   ├── comprehend.md               # Comprehension phase
│   ├── layer-judgment.md           # Layer-judgment phase
│   ├── plan.md                     # Plan generation
│   ├── clarify.md                  # Clarification phase
│   ├── generate.md                 # Code generation
│   └── triage-failure.md           # Failure triage (existing T500 reuse)
├── packs/                          # Install destination for community packs
│   └── nextjs-rules-1.0.0/         # e.g. `@workbench/nextjs-rules`
└── workbench.json                  # `.workbench/` itself: version / settings
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

Project-wide AI context. **Equivalent role to Cursor `.cursorrules` / Claude Code `CLAUDE.md`.**

Example:

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

Reusable test patterns. **One skill = one flow's knowledge.**

Example: `skills/payment-flow.md`

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

**Mandatory rules.** Violations are blocked by post-generate hook.

Example: `rules/locator-policy.md`

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

Per-phase validation / transformation. **Communicates with AI via stdin/stdout:**
- stdin: phase output (JSON)
- stdout: transformed output, or `{"ok":false,"errors":[...]}` to reject
- exit code: 0 = ok, non-zero = block

Example: `hooks/post-generate.sh`

```bash
#!/bin/bash
set -euo pipefail

generated_file="$1"

# Rule check 1: must use data-testid
if grep -q "page.locator(.xpath=" "$generated_file"; then
  echo '{"ok":false,"errors":["xpath locator detected — see rules/locator-policy.md"]}'
  exit 1
fi

# Rule check 2: no arbitrary sleeps
if grep -q "waitForTimeout" "$generated_file"; then
  echo '{"ok":false,"errors":["waitForTimeout detected — use explicit waits"]}'
  exit 1
fi

# TypeScript check
pnpm typecheck "$generated_file" || exit 1

echo '{"ok":true}'
```

### 3.6 `intents/<name>.md`

The **purpose of a test**, written by PM / QA / domain experts. Persistent source of truth.

Example: `intents/checkout-with-saved-card.md`

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

Master prompt templates per phase. Fixed at implementation time. **Not exposed to design partners initially, but candidate for future OSS release.**

---

## 4. Multi-Stage AI Pipeline Detail

### 4.1 Phase A: Explore

**Input**:
- `intents/<name>.md` (where to explore)
- `AGENTS.md` (project context)
- `workbench.json` (engine selection)

**Process**:
- Drive a real UI through Stagehand / Browser Use adapter.
- Use `intent.acceptance examples` as exploration goals.
- Capture DOM snapshots / network logs at each step.
- When unclear, **invoke Phase E (clarify)**.

**Output**: `Screen Model` (JSON, persisted at `.playwright-workbench/runs/<runId>/exploration.json`)

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

### 4.2 Phase B: Comprehend

**Input**: `Screen Model` from Phase A.

**Process**:
- LLM reads the screen model and adds business semantic annotations.
- E.g. "this form is payment input."
- Reconcile with existing specs (duplicate detection).

**Output**: `AnnotatedScreenModel` — Phase A output + annotations.

### 4.3 Phase C: Layer Judgment

**Input**: `AnnotatedScreenModel`, `AGENTS.md`, existing test inventory.

**Process**:
- For each `observedFlow`, AI decides the appropriate test layer.
- Criteria:
  - **unit**: pure logic, no I/O
  - **integration**: 1 component + DB / API stub
  - **contract**: API contract verification
  - **E2E**: full user flow
  - **manual**: hard to automate (UX subjective / visual / device-specific)
  - **none-needed**: existing tests cover it / low importance

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

### 4.4 Phase D: Plan Generation

**Input**: `AnnotatedScreenModel`, only `LayerJudgment[]` whose `recommended === "e2e"`, `intents/<name>.md`, related `skills/<name>.md`.

**Process**:
- One plan = one expected spec file.
- Reference skills to embed step patterns.
- Annotate risk / coverage.

**Output**: `TestPlan` (Markdown, persisted at `.workbench/intents/<name>.plan.md`)

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

### 4.5 Phase E: Clarify

**Input**: `ClarificationRequest[]` from any phase.

**Process**:
- Workbench UI shows inline questions.
- User answers → AI updates the relevant phase output.
- Answers are appended to `intents/<name>.md` (carried over to subsequent runs).

**UI design** (implemented in Phase 1.5-γ):
- Synchronous modal (default): inline during test plan review.
- Asynchronous thread (optional): Slack thread when integrated.

### 4.6 Phase F: Generate Code

**Input**: `TestPlan`, `AGENTS.md`, all `rules/*.md`, the `skills/*.md` referenced by the TestPlan.

**Process**:
- Reuse existing T1100 (AI Test Generation) hardened with rule/skill injection.
- Use prompt template `prompts/generate.md`.
- LLM draft → `pre-generate.sh` hook validates context.
- LLM generation → `post-generate.sh` hook checks rule violations.
- On violation → re-prompt AI to fix (max 3 retries).

**Output**: Playwright TypeScript spec file.

### 4.7 Phase G: Repair Review

**Input**: Generated spec file (as a diff).

**Process**:
- Reuse the existing Phase 1 Repair Review flow as-is (PLAN.v2 §25).
- `git apply --check` → temporary apply → run → compare → approve / reject.
- On approve, create a PR (reuse T1000 series).

**Output**: GitHub PR.

---

## 5. Integration with existing Workbench architecture

Reuse boundaries:

| Existing component | Role in Phase 1.5 | Extension required? |
|---|---|---|
| `CommandRunner` (PLAN.v2 §14) | Run hooks (`pre-explore.sh` etc.) | No — existing policy works |
| `AI Adapter` (PLAN.v2 §26, T500) | LLM calls in Phase B/C/D/F | Yes — prompt template injection, multi-turn support |
| `Project Scanner` (PLAN.v2 §13) | Detect `.workbench/` | Yes — workbench.json parser |
| `Repair Review` (PLAN.v2 §25, T600) | Phase G | Reused as-is |
| `Quality Gate` (PLAN.v2 §23) | Phase G judgment | Reused as-is |
| `Audit Log` | Record every phase / hook | Yes — pipeline-specific audit category |
| `Allure pipeline` (PLAN.v2 §22) | Evaluate runs of generated tests | Reused as-is |
| `Failure Review` (T300) | Drift-correction loop (Phase F → fail → re-explore Phase A) | Yes — Phase A invocation trigger |
| Web UI | Test Plan review UI | Yes — `features/test-plan-review/` |

New components:

| New component | Location |
|---|---|
| `WorkbenchLoader` (.workbench/ parser) | `apps/agent/src/workbench/loader.ts` |
| `ExplorationEngine` (Stagehand wrapper) | `apps/agent/src/exploration/engine.ts` |
| `LayerJudgment` (LLM-driven) | `apps/agent/src/ai/layerJudgment.ts` |
| `TestPlanGenerator` | `apps/agent/src/ai/testPlan.ts` |
| `TestPlanReviewPanel` (UI) | `apps/web/src/features/test-plan-review/` |
| `ConversationalClarifier` | UI + agent both sides |

---

## 6. Versioning & Migration

### 6.1 `.workbench/` versioning

Managed via `workbench.json.version`. **Starts at 0.1**, bumped on each breaking change.

| version | Change |
|---|---|
| 0.1 | Initial (this RFC) |
| 0.2 (planned) | When Phase 2 Quality Signal integration lands |
| 1.0 (after Phase 3) | API stability declaration |

Provide a migration tool (`workbench migrate`) at Phase 1.5-δ.

### 6.2 Adoption to existing projects

```bash
# Initialize via the Workbench Agent CLI
npx playwright-workbench init
# → generates .workbench/ skeleton + sample AGENTS.md / rules / skills
# → suggests .gitignore changes
# → scans existing specs for rule violations
```

---

## 7. Security Considerations

| Domain | Mitigation |
|---|---|
| Secrets in `.workbench/` | Bundle pre-commit-style scanner (gitleaks-equivalent) with hooks |
| Arbitrary hook execution | Hooks limited to `.workbench/hooks/`, restricted by CommandRunner policy |
| Harmful patterns in LLM-generated code | post-generate hook detects forbidden patterns |
| Auth credentials during exploration | Exploration adapter has redaction layer (storageState / cookie values not logged) |
| User API keys | Customer BYOK encouraged; Workbench does not persist (env-only) |
| Audit trail | All phase inputs/outputs recorded in audit.log; tamper-evident in Phase 3 Server |

---

## 8. Open Questions

| # | Question | Target resolution |
|---|---|---|
| OQ-A | Test Plan intermediate schema: markdown only, or also structured JSON? | End of Phase 1.5-α: design-partner feedback |
| OQ-B | Rule pack registry: npm or proprietary (`workbench install`)? | Phase 1.5-δ |
| OQ-C | Hook script language constraint (bash only vs node script allowed)? | Phase 1.5-α |
| OQ-D | Primary exploration engine: Stagehand vs Browser Use vs in-house wrapper? | End of Phase 1.5-β: evaluation dataset |
| OQ-E | Conversation UI: modal or thread? | After Phase 1.5-γ design-partner feedback |
| OQ-F | Should AI update `intents/` during runs (answer persistence)? | Yes per this RFC, but always via confirmation UI |
| OQ-G | Storage of intermediate artifacts from Phase A-D (run-scoped vs `.workbench/cache/`)? | Phase 1.5-α |
| OQ-H | Quality assurance for community rule packs (review process)? | Phase 1.5-δ |

---

## 9. Examples

Complete examples: see [`test-plan-samples/`](../test-plan-samples/):

- [`checkout-with-saved-card.md`](../test-plan-samples/checkout-with-saved-card.md)
- [`password-reset.md`](../test-plan-samples/password-reset.md)
- [`admin-user-suspend.md`](../test-plan-samples/admin-user-suspend.md)

---

## 10. References

- [PRODUCT.en.md](../PRODUCT.en.md) §7 — Multi-stage pipeline diagram
- [PLAN.v3.en.md](../PLAN.v3.en.md) §2 — Phase 1.5 task breakdown
- [PLAN.v2.md](../../../PLAN.v2.md) §14 — CommandRunner Design (reused)
- [PLAN.v2.md](../../../PLAN.v2.md) §26 — AI Adapter Design (reused)
- Cursor `.cursorrules` documentation
- Anthropic Claude Code `CLAUDE.md` documentation
- Stagehand documentation (https://docs.stagehand.dev/)
- Browser Use repository (https://github.com/browser-use/browser-use)

---

## 11. Revision history

- **v0.1** (2026-05): Initial. Defines the `.workbench/` structure and the seven-phase I/O schema for the AI pipeline.
