# Playwright Workbench — Product Vision

> **An AI-native software quality integration platform.**
> A self-hostable OSS foundation that turns testing from "a specialist skill held by code-readers" into "shared organizational knowledge."

**Status**: Draft v3 (2026-05) / **Audience**: design partners / implementation agents (Codex etc.) / internal decision-makers

---

## 1. One-line positioning

A **self-hostable AI-native OSS platform** where QA, QMO, Dev, and SDET reach release decisions on a **single shared screen** for E2E quality.

---

## 2. What we destroy (zero-base)

| Existing process | After |
|---|---|
| QA writes test specs in Excel | PM / domain expert dictates intent; AI shapes it into a Test Plan |
| SDET writes Playwright code line by line | AI explores screens → judges layer → drafts plan → generates code; SDET supervises |
| QA spends a day on manual exploration | AI agent explores 10× more paths in an hour |
| Humans triage every failure | AI classifies and proposes patches; humans approve |
| QMO judges releases via Excel + Allure URLs | AI gives evidence-based recommendations; QMO accepts or rejects |
| Humans clean flaky tests monthly | AI monitors continuously and proposes rotation |
| Spec changes rot the test suite | rule / skill / hook–driven AI keeps tests aligned |

## 3. What we deliberately preserve

- **Playwright runtime** stays the standard. We do not build a proprietary DSL.
- **Generated artifacts are plain TypeScript code** — reviewable, Git-managed, IDE-readable.
- **Final approval stays with humans.** AI recommends, humans decide. Critical for the trust gap in regulated industries.
- **QA expertise is empowered, not replaced.** Democratization means QA becomes a "knowledge worker who directs the AI."

---

## 4. Who we serve

### Phase 1 wedge (now → 12 months)
**"Mid-to-large enterprises (50–500 people) who already use Playwright, whose security policy disallows SaaS, and who struggle with cross-role alignment between QA, Dev, and QMO."**

Concrete personas:
- QA departments at domestic financial institutions (under FISC guidelines)
- Web/SaaS divisions of manufacturing firms (cannot expose infrastructure to external SaaS)
- SI vendors serving public-sector clients (audit-log mandatory environments)
- Late-stage SaaS startups whose QA teams find commercial tools too expensive

### Phase 2-3 expansion (12-36 months)
- Beyond Playwright: Cypress / TestCafe support
- Beyond E2E: unit / integration / load / accessibility / security
- Beyond single runs: continuous exploration

---

## 5. Why now (the 18-month window)

Three technical convergences happened **simultaneously in 2024**:

1. **Foundation models**: Claude 4.x / GPT-5 deliver production-quality structured output and tool use.
2. **Agent computer use**: Anthropic Computer Use / Browser Use / Stagehand make UI operation LLM-driven.
3. **AI cost**: Sonnet 4.x is 1/10 the cost of older models, Haiku is 1/50. **Continuous exploration is now economically viable.**

Within the next **18 months we must establish leadership in the "AI-native + self-hosted" category**, or commercial SaaS vendors will absorb the niche by AI-enhancing their existing products.

---

## 6. Why us (differentiation)

| | Workbench | Mabl/Octomind | Playwright UI Mode | ReportPortal | Cursor / Claude Code |
|---|---|---|---|---|---|
| AI-native multi-stage pipeline | ✅ | ❌ (single-shot generation) | ❌ | ❌ | △ (not for tests) |
| Self-hosted | ✅ | ❌ | N/A | ✅ (heavy) | ❌ |
| Plain Playwright code output | ✅ | ❌ (proprietary DSL) | ✅ | ✅ | ✅ |
| rule / skill / hook guardrails | ✅ | ❌ | ❌ | ❌ | ✅ (product code only) |
| Cross-role view (QA / QMO / Dev) | ✅ | △ | ❌ | △ | ❌ |
| Quality Gate / history / release decision | ✅ | ❌ | ❌ | △ | ❌ |
| Exploratory-agent integration (Phase 2) | ✅ | △ | ❌ | ❌ | ❌ |

**No existing product covers this combination.**

---

## 7. The multi-stage AI pipeline at the core

```
┌──────────────────┐  Browser Use / Stagehand / Playwright agent
│ A. Explore        │  → traverse the real UI, build a screen model
└──────────────────┘
         ▼
┌──────────────────┐  LLM annotates DOM / network / state transitions
│ B. Comprehend     │
└──────────────────┘
         ▼
┌──────────────────┐  AI decides unit / integration / E2E / unnecessary
│ C. Layer judgment │  Standalone feature: "AI Test Strategy Advisor"
└──────────────────┘
         ▼
┌──────────────────┐  Markdown plan readable by non-engineers
│ D. Test Plan      │  Core artifact for "democratizing testing"
└──────────────────┘
         ▼
┌──────────────────┐  AI asks the user inline when ambiguous
│ E. Clarify        │  Mabl/Octomind do not ask; we do
└──────────────────┘
         ▼
┌──────────────────┐  rule / skill / hook drive plain Playwright generation
│ F. Generate code  │
└──────────────────┘
         ▼
┌──────────────────┐  Existing Repair Review flow gates human approval
│ G. Repair Review  │
└──────────────────┘
```

Detailed per-phase specs: see [`docs/product/rfcs/0001-workbench-directory.en.md`](rfcs/0001-workbench-directory.en.md).

---

## 8. Roadmap at a glance

| Phase | Duration | Core | Status |
|---|---|---|---|
| **Phase 0** | Done | Product definition, PoC scope | ✅ |
| **Phase 1** | Done | Local Runner + Allure pipeline + Quality Gate + AI triage + Repair Review (PLAN.v2 §29) | ✅ |
| **Phase 1.5** | 4-12 mo | **agent + rule + skill + hook foundation**, **multi-stage AI pipeline**, **Test Plan generation**, `.workbench/` standardization | Planning |
| **Phase 2** | 12-24 mo | Quality Signal Bus, exploratory-agent integration, CI replay, automated PR-comment posting | Planning |
| **Phase 3** | 24-36 mo | Integrated quality platform (merge unit / load / accessibility / security signals), Server product, self-hosted RBAC | Vision |

Details: see [`PLAN.v3.en.md`](PLAN.v3.en.md).

---

## 9. Strategic risks and mitigations

| Risk | Mitigation |
|---|---|
| Foundation-model dependency | Model-agnostic prompts, BYO API key, local-LLM fallback |
| No data flywheel for self-hosted | Opt-in anonymized telemetry, community-curated rule packs, ride foundation-model improvements |
| Trust gap (regulated industries reject AI) | AI is recommendation only; humans approve; tamper-evident audit log of generation |
| AI-cost blow-up | Tier design, caching, cheap-model routing (Haiku for triage tasks) |
| Product scope vs. team scope | Phase 1.5 reachable bootstrapped; Phase 2+ requires hiring and capital |
| QA-department resistance | "Empower QA, do not replace" narrative; reposition QA as AI-directing knowledge worker |

---

## 10. Distribution

- **Workbench Agent**: `npx playwright-workbench --project <path>` to start. Distributed as an npm package. Completed in Phase 1.
- **Workbench Server** (introduced in Phase 2-3): self-hosted via k8s / docker compose. PostgreSQL + S3-compatible storage. Adds RBAC, audit log, multi-user comments.
- **Workbench Cloud SaaS**: not provided (at least for the foreseeable future). SaaS would contradict the wedge.

---

## 11. Related documents

- [PLAN.v3.en.md](PLAN.v3.en.md) — detailed roadmap for Phase 1.5 / 2 / 3
- [rfcs/0001-workbench-directory.en.md](rfcs/0001-workbench-directory.en.md) — `.workbench/` specification, full pipeline detail
- [test-plan-samples/](test-plan-samples/) — three Test Plan output samples
- [PLAN.v2.md](../../PLAN.v2.md) — Phase 1 implementation reference (active)

---

## 12. Status

- **Phase 1 (PoC)**: complete. Verified against `sample-pw-allure-project`. `pnpm test` passes 943 cases. CI green.
- **Phase 1.5**: RFC drafting in progress. Recruiting design partners.
- **Phase 2/3**: in conception.

We welcome feedback from design-partner candidates, implementation agents, and internal stakeholders.
