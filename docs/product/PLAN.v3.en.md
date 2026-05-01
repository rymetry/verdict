# PLAN.v3 — Phase 1.5 / 2 / 3 Roadmap

> **Reference point**: PLAN.v2 (Phase 1, complete) is included as Phase 1; Phase 1.5 / 2 / 3 are newly defined here.
> v2 remains the active implementation reference. v3 is a **roadmap document** that frames the next 24-36 months. It is not implementation detail.
>
> **Status**: Draft v3 (2026-05) / **Audience**: implementation agents (Codex etc.) / internal decision-makers / advanced design partners

---

## 0. Vision and positioning

The product vision lives in [`PRODUCT.en.md`](PRODUCT.en.md), which is the source of truth. This document is the **implementation roadmap from Phase 1.5 onward**.

### Relationship with v2

| Document | Role | Status |
|---|---|---|
| `PLAN.v2.md` (root) | Implementation reference for Phase 0 / 1 / 1.2. Detailed specs for CommandRunner / Allure / Quality Gate / AI / Repair | ✅ Complete, actively referenced |
| `PRODUCT.en.md` (this docs) | Product vision, positioning, differentiation | ✅ Draft |
| `PLAN.v3.en.md` (this) | Roadmap, dependencies, success criteria for Phase 1.5 / 2 / 3 | ✅ Draft |
| `rfcs/0001-workbench-directory.en.md` | Technical spec for `.workbench/` and the multi-stage AI pipeline | ✅ Draft |

When v2 and this document conflict, **prefer v2 for already-implemented matters and v3 for forward direction**.

---

## 1. Phase 1 (complete — summary of v2)

The PoC scope defined in PLAN.v2 §29. In this roadmap, **Phase 1 = baseline**.

### Completed core features
- Project open + Playwright project detection + PackageManagerDetector
- Spec/test inventory (`playwright test --list --reporter=json`)
- NodeCommandRunner (no shell, argv-only, policy, cwd boundary, audit log)
- GUI-driven run + stdout/stderr streaming + JSON result persistence
- Allure detect/archive/copy lifecycle + HTML report generation + history JSONL + CSV/log export
- Quality Gate profile evaluation (local-review / release-smoke / full-regression) + advisory enforcement
- Failure Review (stack / artifact / Allure history / known issue / flaky signal aggregation)
- AI Analysis (Claude CLI adapter + redacted context + zod-validated AI output)
- Repair Review (`git apply --check` + temporary apply + rerun + before/after comparison)
- AI Test Generation (planner / generator / healer schema + Quality Gate enforcement)
- Release Review Draft + CI artifact import (metadata only, no external fetch)
- Cross-role UI (QA / Developer / Insights view, shadcn/ui + TanStack Router)

### Phase 1 follow-ups handled in this document

From `IMPLEMENTATION_REPORT.md` known constraints, deferred to Phase 1.5+:
- Settings page (absorbed into `.workbench/` configuration UI in Phase 1.5)
- Developer View Source / Diff / Terminal / Console panes (re-evaluated in Phase 1.5)
- Bun support (validated in Phase 1.5)
- ReportPortal parallel provider (re-evaluated in Phase 3)

---

## 2. Phase 1.5 — AI-native multi-stage pipeline foundation (4-12 months)

### 2.1 Goal

Layer the **`.workbench/` directory + multi-stage AI pipeline** on top of the Phase 1 foundation, completing the workflow where **AI generates tests via a Plan**. This implements the core pipeline defined in PRODUCT §7.

### 2.2 Core deliverables

| # | Deliverable | Location |
|---|---|---|
| T1500-1 | Finalize `.workbench/` directory specification | `rfcs/0001-workbench-directory.en.md` |
| T1500-2 | Loaders for AGENTS.md / skills/ / rules/ / hooks/ / intents/ / prompts/ | `apps/agent/src/workbench/` (new) |
| T1500-3 | Exploration Engine (Stagehand / Browser Use adapter) | `apps/agent/src/exploration/` (new) |
| T1500-4 | Screen Model schema + comprehension layer | `packages/shared/src/exploration.ts` (new) |
| T1500-5 | Test Layer Judgment (AI Test Strategy Advisor) | `apps/agent/src/ai/layerJudgment.ts` (new) |
| T1500-6 | Test Plan Generator (Markdown output) | `apps/agent/src/ai/testPlan.ts` (new) |
| T1500-7 | Conversational Clarification UI | `apps/web/src/features/test-plan-review/` (new) |
| T1500-8 | Code generation hardening (rule/skill/hook context injection) | Existing `apps/agent/src/ai/cliAdapter.ts` extension |
| T1500-9 | Plan-driven Repair Review integration | Existing `apps/agent/src/repair/` extension |
| T1500-10 | Community rule pack registry (OSS) | Separate repo `playwright-workbench-rules/` |

### 2.3 Implementation order

```
Phase 1.5-α (1-3 months): Foundation
  T1500-1, T1500-2 — Finalize `.workbench/` spec + loaders
  T1500-8 hardening — rule/skill/hook context injection (extending existing T1100)
  → Existing AI Test Generation becomes rule-aware, generation accuracy rises

Phase 1.5-β (3-6 months): Exploration & Plan
  T1500-3, T1500-4 — Exploration Engine + Screen Model
  T1500-5, T1500-6 — Layer Judgment + Test Plan Generator
  → Exploration → plan operational; code generation reuses existing T1100

Phase 1.5-γ (6-9 months): UX completion
  T1500-7, T1500-9 — Conversational UI + Plan-driven Repair Review
  → Full multi-stage pipeline ready to demo to design partners

Phase 1.5-δ (9-12 months): Ecosystem
  T1500-10 — Public OSS rule packs
  → Community engagement; foundation for Phase 2
```

### 2.4 Phase 1.5 success criteria

- ✅ `.workbench/` is committed naturally to repos (penetration on par with Cursor `.cursorrules`)
- ✅ Test Plans are evaluated by design-partner QA / PMs as "readable / discussable"
- ✅ At least one design partner uses Workbench-generated Test Plans for an actual release decision
- ✅ Generated tests have a rule-violation rate < 5% (measured by post-generate hook)
- ✅ Exploration cost < $5 per plan (with cache + cheap-model routing)
- ✅ AI Test Strategy Advisor classifies "unit / E2E / unnecessary" with > 80% accuracy on an evaluation dataset

### 2.5 Deliberately NOT in Phase 1.5

- Exploratory testing agents (Phase 2 territory)
- Cypress / TestCafe support (focus on Playwright)
- Multi-user state / RBAC / Server (Phase 3 territory)
- SaaS deployment (possibly never)
- Visual regression / accessibility scanner (Phase 2, when Quality Signal Bus arrives)

### 2.6 Phase 1.5 risks

| Risk | Mitigation |
|---|---|
| Exploration engine instability against dynamic DOM | Default Stagehand, fallback Browser Use, retry policy |
| LLM-generated plan quality variance | Community `.workbench/skills/` packs + evaluation dataset operations |
| Initial cost of writing rules (customer effort) | Pre-publish OSS rule packs for major frameworks (Next.js / Vue / Rails) |
| Slow design-partner acquisition | Launch at end of Phase 1.5-α with `.workbench/` working, even if pipeline incomplete |
| Competitor copying (Octomind etc. adopt explore→plan path) | rule/skill/hook + self-hosted maintain the moat |

---

## 3. Phase 2 — Quality Signal Bus and exploratory-agent integration (12-24 months)

### 3.1 Goal

Take the first step from **"a Playwright-only tool"** toward **"a hub for integrating quality signals."** Introduce a unified Quality Signal abstraction so multiple sources of quality data converge on a single decision view.

### 3.2 Core deliverables

| # | Deliverable | Summary |
|---|---|---|
| T2000-1 | Establish Quality Signal abstraction | Shared schema with unified source / category / severity / evidence types |
| T2000-2 | Import results from exploratory testing agents | Convert Octomind exploratory / TestZeus / in-house agent output to Quality Signals |
| T2000-3 | Visual regression import (BackstopJS / Percy) | Display alongside current Allure attachments |
| T2000-4 | Accessibility import (axe-core) | A11y as a Quality Signal source |
| T2000-5 | CI replay (`--replay github://owner/repo/runs/N`) | Reproduce a failed CI run locally — hero feature |
| T2000-6 | Automated GitHub PR comment posting | Output of `release-review-draft` via GitHub App |
| T2000-7 | Slack / Teams alert (flaky / critical fail) | Webhook integration |
| T2000-8 | Sharable Bundle (zip + static HTML) | Multi-role sharing without a Cloud server |
| T2000-9 | Cypress / TestCafe runner adapter | Support E2E runners beyond Playwright |

### 3.3 Quality Signal Bus structure

```
┌─────────────────────────────────────────────┐
│ Quality Signal {                              │
│   source: "playwright" | "exploratory"        │
│         | "visual" | "axe" | "manual" | ...   │
│   category: "regression" | "exploration"      │
│           | "performance" | "accessibility"   │
│           | "security"                         │
│   severity: "critical" | "high" | "medium"   │
│           | "low" | "info"                    │
│   evidence: ArtifactRef[]                     │
│   context: { commit, run, pr, ... }           │
│   triage: { status, assignee, comment_id }    │
│ }                                              │
└─────────────────────────────────────────────┘
                    ▲
        Each source adapter pushes here
                    ▼
┌─────────────────────────────────────────────┐
│ Workbench Quality View                        │
│ - Quality Gate that integrates all signals    │
│ - Role-aware narrative generation             │
│ - History / trend / cross-cut search          │
└─────────────────────────────────────────────┘
```

### 3.4 Phase 2 success criteria

- ✅ ≥3 distinct Quality sources (Playwright + exploratory agent + 1 more) feed the same Quality Gate
- ✅ CI replay works in one command and is used ≥5 times/month in design-partner environments
- ✅ Workbench-bot PR comments become standard practice
- ✅ At least one case where non-engineers (PM / sales) viewed Workbench results via Sharable Bundle
- ✅ At least one Cypress / TestCafe user joins as a design partner

### 3.5 Phase 2 risks

| Risk | Mitigation |
|---|---|
| Exploratory-agent output schemas not unified | Adapter abstraction in Workbench; per-agent converters |
| GitHub App distribution operational burden | Distribute as OSS App; design so enterprise self-hosted GitHub App also works |
| Premature generalization in Quality Signal abstraction | Lock the schema only after implementing 3 sources (Playwright + exploratory + visual) |
| Secrets leaking through Bundle exchange | Document redaction policy, mandate auto-redaction at bundle generation |

---

## 4. Phase 3 — Integrated Quality Platform + Server product (24-36 months)

### 4.1 Goal

Promote Workbench from **"a tool for individuals/teams"** to **"an organizational quality decision platform."** Introduce a Server product that adds multi-user, RBAC, persistent comments, cross-cut search, and ML-driven prediction.

### 4.2 Core deliverables

| # | Deliverable | Summary |
|---|---|---|
| T3000-1 | Workbench Server foundation | Hono-based API + PostgreSQL + S3-compatible blob |
| T3000-2 | OIDC / SAML / LDAP authentication | Enterprise requirement |
| T3000-3 | RBAC (per role / project / artifact) | Commercial-tier permission model |
| T3000-4 | Tamper-evident audit log | Compliance for regulated industries |
| T3000-5 | Failure comments / triage state / assignees | Multi-user collaboration |
| T3000-6 | Cross-cut search ("find all failures with this error in last 30 days") | Log-aggregation-style feature |
| T3000-7 | Continuous exploration engine | 24-hour autonomous exploration, new-flow detection |
| T3000-8 | Org-wide quality intelligence | Per-feature risk score, test gap detection |
| T3000-9 | ML-driven release prediction | "Ship probability" predicted from historical run data |
| T3000-10 | Helm chart / docker compose distribution + upgrade strategy | Self-hosted operations |

### 4.3 Server / Agent relationship

```
┌──────────────────────────────────────────┐
│ Workbench Server (introduced in Phase 3)  │
│ - history / triage / comment / RBAC / audit│
│ - PostgreSQL + S3-compatible blob          │
│ - Self-hosted (k8s / docker compose)       │
└──────────────────────────────────────────┘
           ▲ push (run artifact bundle)
           │ pull (history / config / rule)
           │
┌──────────────────────────────────────────┐
│ Workbench Agent (Phase 1, existing)        │
│ - local execution, artifact generation     │
│ - works standalone without Server          │
│ - distributed as npm package               │
└──────────────────────────────────────────┘
```

**Important**: The Agent (existing in Phase 1) works fully without the Server. **Server is opt-in extension.**

### 4.4 Phase 3 success criteria

- ✅ ≥3 organizations operate self-hosted Server in production
- ✅ ≥1 production adoption in a regulated industry (finance / healthcare / public sector)
- ✅ Continuous exploration discovers new bugs ≥1 per month
- ✅ Test-strategy optimization recommendations from Quality Intelligence are adopted in practice
- ✅ Helm install to operational state in ≤30 minutes

### 4.5 Phase 3 risks

| Risk | Mitigation |
|---|---|
| Server productization adds 1.5-2 years of work | Wedge completed in Phase 1.5 / 2 secures funding & hiring via design partners |
| Multi-tenant design complexity | Self-hosted only; no in-product multi-tenancy. tenant = deployment |
| Time-cost of polishing auth / RBAC | Adopt OSS policy engines (Casbin / Cedar); avoid in-house implementation |
| Compliance documentation (SOC2 / ISO 27001) | Self-hosted means Workbench itself does not need certification; each customer deployment certifies internally |

---

## 5. Cross-cutting strategy

### 5.1 Self-hosted distribution

Phase 1: npm package (Agent) only.
Phase 2: same Agent gains CI integration and Bundle features.
Phase 3: official helm chart / docker compose distribution; optional k8s operator.

**No SaaS offering.** Reasoning: see PRODUCT §10.

### 5.2 AI cost management

Three-layer defense:
1. **Cache**: identical prompt + context hits the cache.
2. **Model routing**: triage on Haiku, generation on Sonnet, only huge contexts on Opus.
3. **Customer API key**: customer holds a direct contract with the LLM provider; Workbench is a stateless caller.

This yields:
- Solo developer: < $5 / month
- Mid-sized team: $50-200 / month
- Large enterprise: $1k-5k / month (1/10 to 1/50 of commercial tools)

### 5.3 OSS / community strategy

| Domain | Strategy |
|---|---|
| Workbench core | OSS (MIT), main repo |
| Workbench Server | OSS (MIT), released in Phase 3 |
| rule packs | OSS, community packs like `@workbench/nextjs-rules` |
| skill packs | OSS, e.g. `@workbench/saas-checkout-skills` |
| design partners | Limited preview, co-create features, OSS contribution expected |
| Commercial offering | After Phase 3, consider support contracts / managed services |

### 5.4 i18n

Phase 1 / 1.5 — Japanese first (PRODUCT, PLAN, RFC are bilingual).
UI is Japanese-first; English in Phase 2.
Phase 3 considers other languages (Chinese / Korean).

---

## 6. Definition of Done per Phase

### Phase 1 (complete)
Per PLAN.v2 §32. `pnpm test` 943 cases + `pnpm smoke:gui:allure` all pass. CI green.

### Phase 1.5
- `.workbench/` spec RFC finalized; `rfcs/0001` is "Accepted"
- All seven phases of the multi-stage pipeline operate in a demo
- ≥1 design partner uses it in production
- Rule violation rate < 5%; Layer Judgment accuracy > 80%

### Phase 2
- ≥3 Quality Signal sources integrated
- CI replay works in one command
- ≥1 of Cypress / TestCafe adapter delivered

### Phase 3
- Server reaches operational state ≤30 min from helm install
- ≥3 self-hosted production deployments
- ≥1 regulated-industry adoption
- Continuous exploration finds bugs monthly

---

## 7. Open Questions

Carried over from PLAN.v2 §34 plus new items:

| # | Question | Target resolution |
|---|---|---|
| OQ-1 | Distribution package name (`playwright-workbench` final?) | Phase 1.5-α |
| OQ-2 | Primary exploration engine (Stagehand vs Browser Use) | Decided after empirical evaluation at end of Phase 1.5-α |
| OQ-3 | Rule pack registry format (npm? GitHub Releases?) | Phase 1.5-δ |
| OQ-4 | Conversation UI: synchronous (modal) or asynchronous (slack-like thread) | After Phase 1.5-γ design-partner feedback |
| OQ-5 | Final shape of Quality Signal schema | Mid-Phase 2, after 3 sources implemented |
| OQ-6 | Team size and funding timing for Server productization | Re-evaluated at end of Phase 1.5 |
| OQ-7 | How to distribute GitHub App for self-hosted | At Phase 2-T2000-6 kickoff |
| OQ-8 | Test Plan intermediate schema (markdown vs structured JSON) | Decided early in RFC 0001 |
| OQ-9 | API contract with exploratory testing agents | At Phase 2-T2000-2 kickoff |

---

## 8. Related documents

- [PRODUCT.en.md](PRODUCT.en.md) — Product vision (source of truth)
- [PLAN.v2.md](../../PLAN.v2.md) — Phase 1 implementation reference (active)
- [rfcs/0001-workbench-directory.en.md](rfcs/0001-workbench-directory.en.md) — `.workbench/` + multi-stage pipeline detail
- [test-plan-samples/](test-plan-samples/) — Test Plan output samples

---

## 9. Revision history

- **v3.0** (2026-05): Initial. Defined Phase 1.5 / 2 / 3. Established the roadmap covering `.workbench/` + multi-stage AI pipeline + Quality Signal Bus + Server product.
