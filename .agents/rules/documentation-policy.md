# Rule: Documentation Policy

**Status**: enforced (low ambiguity, high cost when violated)

Verdict has multiple authoritative documents. They are not interchangeable. This rule defines who edits what, when.

## The document hierarchy

| Document | Status | Owner of changes | Edit when |
|---|---|---|---|
| `PRODUCT.md` (product/) | Active vision | rare; user / PdM | Vision shifts (new wedge, new positioning) |
| `PLAN.v3.md` | Active roadmap | author of new T-task | New phase milestone, new T-task scope |
| `PLAN.v2.md` (root) | **Frozen** Phase 1 reference | nobody | **Never**. Treat as historical record. |
| `IMPLEMENTATION_REPORT.md` (root) | Frozen Phase 1 completion record | nobody | Never. Phase 1.5+ gets its own report. |
| `docs/product/rfcs/0001-*` and successors | Active design specs | RFC author | When the design changes — write a new RFC version, do not silently rewrite |
| `docs/operations/*` | Active operations docs | engineer who changes the operation | Whenever runbooks change (PoC guide, ReportPortal, Bun) |
| `docs/design/concept-b-refined.html` | UI/UX SoT | designer | Visual design changes |
| `AGENTS.md` (root) | Active agent context | engineer making conventions explicit | New rule, skill, or convention |
| `.agents/rules/*.md` | Active rules | rule author | New invariant or boundary |
| `.agents/skills/*/SKILL.md` | Active skills | skill author | New reusable workflow |
| `README.md` (root) | Public-facing | release engineer | Release-relevant changes |

## When PLAN.v2 conflicts with PLAN.v3

PLAN.v2 has the authoritative Phase 1 implementation invariants. PLAN.v3 has the forward-looking direction. Where they appear to disagree:

- For **already-implemented behavior**: PLAN.v2 wins. Do not edit PLAN.v2 to "fix" the disagreement; instead document the change in PLAN.v3 or a new RFC.
- For **future direction**: PLAN.v3 wins.

PLAN.v3 sec 0 establishes this; the `chore: product vision v3` PR documented the framing.

## RFC versioning

- An RFC has a version (`v0.1`, `v0.2`, ...) and a status (`Draft`, `Accepted`, `Superseded`).
- A breaking design change creates a new version of the RFC; do not silently rewrite history. The "Revision history" section at the bottom records each bump.
- When an RFC is superseded entirely, mark it `Superseded` and link to the replacement.

## Forbidden

- Editing `PLAN.v2.md` to retcon Phase 1 history.
- Editing `IMPLEMENTATION_REPORT.md` for any reason.
- Adding "TODO" / "FIXME" to PLAN.v2 / IMPLEMENTATION_REPORT (reroute to PLAN.v3 follow-up).
- Adding a new convention to `AGENTS.md` without also adding a corresponding rule under `.agents/rules/`. AGENTS.md is the index; rules are the substance.
- Creating a new top-level Markdown file at the repo root for design discussion. New design lives under `docs/product/rfcs/` or as a skill / rule.

## Reviewer checklist

- [ ] Did the PR touch a frozen document (`PLAN.v2.md`, `IMPLEMENTATION_REPORT.md`)? If yes, hard reject.
- [ ] Does the PR introduce a new convention without a rule entry in `.agents/rules/`?
- [ ] Does the PR introduce a new T-task without an entry in PLAN.v3?
- [ ] Are external-facing files (README, PRODUCT, PLAN.v3) bilingual where the convention applies?
