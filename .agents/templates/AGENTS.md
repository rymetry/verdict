# Agent Autonomy Context

This repository uses the generic autonomy lifecycle:

```text
Think -> Plan -> Build -> QA -> Review -> Ship -> optional Deploy/Monitor -> Learn
```

Read `.agents/autonomy.config.json` first. Project-specific rules live under
`.agents/rules/`, reusable workflows live under `.agents/skills/`, and runtime
state lives under `.agents/state/` and must not be committed.

The default `markdown-roadmap` task source reads unchecked Markdown tasks from
`ROADMAP.md`, `docs/ROADMAP.md`, `docs/roadmap.md`, or `TODO.md`:

```markdown
- [ ] ROADMAP-1: Describe the next deliverable
```

This template ships the configuration, hooks, rules, and skill layer. The
autonomy engine itself must be supplied by the consuming repository or by an
installed package. Expose these commands before running the lifecycle:

- `agent-autonomy-drive` or an equivalent `agents:drive` script
- `agent-autonomy-progress` or an equivalent `agents:progress` script

Useful driver commands:

- `agent-autonomy-drive --dry-run` resolves the configured lifecycle without
  executing side effects.
- `agent-autonomy-drive --run-review <pr>` writes a structured review gate file
  under `.agents/state/`.
- `agent-autonomy-drive --ship-pr <pr> --qa-pass --review-file <file>
  --auto-merge` evaluates the ship gate and merges only when policy allows it.
- `agent-autonomy-drive --run-deploy --task-id <id>` runs optional
  Deploy/Monitor stages. Production deploys require either
  `deploy.productionPolicy: "auto"` or `--approval-granted`.

The bundled edit hook does not execute package scripts unless
`AGENTS_HOOK_RUN_TYPECHECK=1` is set for that repository.

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

Review commands must emit structured JSON:

```json
{
  "expectedReviewers": ["diff-review", "ai-review"],
  "reviews": [
    {
      "reviewer": "diff-review",
      "status": "pass",
      "findings": [],
      "summary": "Reviewed changed files."
    }
  ]
}
```

Deploy commands are no-shell argv arrays. The driver expands
`{taskId}`, `{environment}`, `{stage}`, and `{healthCheckUrl}` placeholders.
