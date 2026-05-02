# Rule: Release Gates

Merge only when all required gates pass:

- CI green.
- QA or configured smoke check passes.
- AI review has no P0/P1 findings.
- Scope check passes.
- Working tree is clean.

Deploy only when the repository config defines a deploy provider. Production
deploy requires explicit `productionPolicy: "auto"` or a human approval gate.
