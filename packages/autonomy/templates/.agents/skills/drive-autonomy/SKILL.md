---
name: drive-autonomy
description: Run the generic autonomy lifecycle for this repository. Use when the user asks the agent to continue autonomous development, pick the next task, create a PR, ship, or learn from the result.
---

# Drive autonomy

Read `.agents/autonomy.config.json`, then run the lifecycle:

```text
Think -> Plan -> Build -> QA -> Review -> Ship -> optional Deploy/Monitor -> Learn
```

This template does not ship the autonomy engine. If the consuming repository has
installed one, use `agent-autonomy-drive --dry-run` or the repository's
equivalent script for non-mutating validation.

If no engine command exists yet, run the lifecycle manually: inspect the config,
write down the selected task, execute the smallest safe change, run the repo's
normal verification commands, review for P0/P1 findings, and stop before merge
or deploy unless the release gates are explicit.

Full execution must respect `.agents/rules/safety.md` and
`.agents/rules/release-gates.md`.
