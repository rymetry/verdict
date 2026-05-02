# Agent Autonomy Context

This repository uses the generic autonomy lifecycle:

```text
Think -> Plan -> Build -> QA -> Review -> Ship -> optional Deploy/Monitor -> Learn
```

Read `.agents/autonomy.config.json` first. Project-specific rules live under
`.agents/rules/`, reusable workflows live under `.agents/skills/`, and runtime
state lives under `.agents/state/` and must not be committed.

When adopting the foundation in an existing repository, seed the local completed
baseline before the first driver run:

```bash
agent-autonomy-progress seed-completed --ids <task-id[,task-id...]>
```

Only seed ids that have already landed in the repository's accepted baseline.
The driver treats `.agents/state/progress.json` as operator-provided local state
and will not infer completion from branch history.

Default safety gates:

- Do not merge unless CI, QA, scope, and AI review gates pass.
- Stop before high-risk changes unless the repo config explicitly allows them.
- Stop on repeated failures, tool authentication failures, network failures, or
  canary failures.
- Never commit secrets or per-machine state.
