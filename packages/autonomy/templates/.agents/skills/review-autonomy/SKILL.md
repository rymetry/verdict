---
name: review-autonomy
description: Review an autonomy run before it is promoted into a template or trusted for automatic merge/deploy.
---

# Review autonomy

Check:

- Generic core does not depend on one product's roadmap or package manager.
- Project-specific task picking lives in an adapter.
- Timeline, progress, and learnings are written under `.agents/state/`.
- Release gates block red CI, P0/P1 findings, scope violations, and canary failures.
- Template files can be installed into an empty repository without overwriting existing files unless forced.
