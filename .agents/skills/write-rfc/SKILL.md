---
name: write-rfc
description: Use when proposing a design change that spans 2+ components, introduces a new external integration (GitHub App, vendor SDK), defines a new on-disk format or CLI flag, or affects security/privacy. For single-package refactors or local fixes, skip the RFC and use a tight commit message instead. Defines the RFC template, status lifecycle (Draft/Accepted/Implemented), and review process.
---

# Write or revise an RFC

RFCs in Verdict live under `docs/product/rfcs/`. The first one (`0001-workbench-directory.md`) defines the `.workbench/` directory and the multi-stage AI pipeline. New RFCs follow the same shape so reviewers know where to find each section.

## When to use

- The change spans 2+ components (e.g. agent + web, or shared schema + agent + web).
- The design has user-facing impact (new file layout, new CLI flag, new GitHub App).
- The design affects security, privacy, or compliance posture.
- A single PR cannot capture the full design (you anticipate a phased rollout).
- An existing RFC's design decision is being reversed or significantly amended.

If the change is local to one file or one package, **a code comment + a tight commit message is enough** — do not over-engineer with an RFC.

## Template

Use this shape for new RFCs:

```markdown
# RFC NNNN: <Title>

| Field | Value |
|---|---|
| Status | Draft |
| Authors | Verdict team |
| Created | YYYY-MM |
| Target | <Phase or milestone>
| Supersedes | <prior RFC, if any>
| Related | <links to PRODUCT, PLAN, prior RFCs> |

---

## 1. Motivation

What is the problem? Why now? What is the cost of doing nothing?

## 2. Goals & Non-goals

### Goals
- ...

### Non-goals
- ... (explicitly bound the scope; prevent reviewers from asking for unrelated features)

## 3. Detailed design

The substance. Include diagrams (ASCII / mermaid) when helpful. Reference existing
component names exactly so the reader can grep.

## 4. Integration with existing architecture

Reuse boundaries — what's new, what's reused, what's deprecated. Map deltas back
to PLAN.v3 task IDs.

## 5. Versioning & migration

If this introduces a versioned artifact (config, on-disk schema), document the
migration story up-front. "Customers who installed v0.1 must..." sentences here.

## 6. Security considerations

Threat model. What new attack surfaces does this open? How are they mitigated?
Cross-reference `.agents/rules/secret-handling.md`, `.agents/rules/no-shell.md`,
`.agents/rules/path-safety.md` as applicable.

## 7. Open questions

Numbered questions with target resolution dates / phases. These become the
review-discussion anchors.

## 8. Examples

Concrete examples — fully filled-in, not skeletons. The reader should be able to
imagine the end state from these.

## 9. References

Internal: PRODUCT, PLAN.v3, prior RFCs.
External: vendor docs (Stagehand, Anthropic, etc.) — fetched, not assumed.

## 10. Revision history

- **v0.1** (YYYY-MM): Initial.
- **v0.2** (YYYY-MM): <reason for change>.
```

## Numbering

`0001`, `0002`, ... in chronological order. Always 4 digits. Do not skip numbers.

## Status lifecycle

- `Draft` — under active iteration. Changes are expected.
- `Accepted` — design has been agreed; implementation may or may not be complete.
- `Implemented` — design is realized in code; the RFC remains as documentation.
- `Superseded by NNNN` — replaced by a newer RFC.

To change status, edit the metadata table at the top **and** add a Revision history line at the bottom.

## Drafting flow

1. Open a working branch: `docs/rfc-NNNN-short-title`.
2. Copy the template above into `docs/product/rfcs/NNNN-short-title.md`.
3. Write the JA version first (or EN if the project is moving English-first), then translate to the other in `NNNN-short-title.en.md`.
4. PR title: `docs(rfc-NNNN): <one-line>`.
5. Solicit review from at least one human + one AI reviewer (Codex or Claude). Loop until both approve.
6. On merge, the status starts as `Draft`. The first PR that implements a major chunk should bump it to `Accepted`.

## Forbidden

- "Stealth" RFCs (a normal feature PR that quietly carries 500 lines of design discussion in the body). Split into RFC PR + implementation PRs.
- Revising an `Accepted` or `Implemented` RFC without bumping the version.
- Citing external links without reading them; reviewers will catch unverified claims.
- Inventing new component / file names that conflict with existing ones.

## Reference

- `docs/product/rfcs/0001-workbench-directory.md` — the canonical reference for shape.
- `docs/product/rfcs/README.md` (if present) — index of all RFCs and their statuses.

## Related

- `.agents/skills/execute-t-task/SKILL.md` — the implementation flow that follows an Accepted RFC.
- `.agents/rules/documentation-policy.md` — where RFCs sit in the document hierarchy.
