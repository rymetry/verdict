---
name: drive-autonomy
description: Run the generic autonomy lifecycle for this repository. Use when the user asks the agent to continue autonomous development, pick the next task, create a PR, ship, or learn from the result.
---

# Drive autonomy

Read `.agents/autonomy.config.json`, then run the lifecycle:

```text
Think -> Plan -> Build -> QA -> Review -> Ship -> optional Deploy/Monitor -> Learn
```

Use `agent-autonomy-drive --dry-run` or the repository's equivalent script for
non-mutating validation. Full execution must respect `.agents/rules/safety.md`
and `.agents/rules/release-gates.md`.
