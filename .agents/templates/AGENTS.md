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
- `agent-autonomy-review` for deterministic diff review, and optionally
  `agent-autonomy-ai-review` for Codex / Claude review
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

The package provides two standard reviewer commands:

```bash
agent-autonomy-review --pr <number>
agent-autonomy-ai-review --runtime codex --pr <number>
agent-autonomy-ai-review --runtime claude --pr <number>
```

Keep AI reviewers opt-in in `.agents/autonomy.config.json`; they call external
AI CLIs and can fail on auth, network, or quota. The wrapper sends the review
prompt through stdin and marks the PR diff as untrusted data. Claude review runs
with tools disabled. Codex review is disabled by default because Codex CLI does
not expose a no-tools review mode; set
`AUTONOMY_ALLOW_CODEX_AI_REVIEW_WITH_TOOLS=true` only when accepting read-capable
reviewer risk. Reviewer identity is taken from the trusted CLI runtime, not
model output. A typical explicit gate uses deterministic diff review and Claude:

```json
{
  "reviewers": {
    "customCommands": [
      {
        "name": "diff-review",
        "command": ["agent-autonomy-review", "--pr", "{prNumber}"],
        "expectedReviewers": ["diff-review"],
        "timeoutMs": 60000
      },
      {
        "name": "claude-review",
        "command": ["agent-autonomy-ai-review", "--runtime", "claude", "--pr", "{prNumber}"],
        "expectedReviewers": ["claude-review"],
        "timeoutMs": 300000
      }
    ]
  }
}
```

Deploy commands are no-shell argv arrays. The driver expands
`{taskId}`, `{environment}`, `{stage}`, `{healthCheckUrl}`, and `{deployUrl}`
placeholders. `provider: "vercel-compatible"` runs `vercel deploy --yes`
by default, adds `--prod` for production, prefers the first `*.vercel.app`
URL from stdout, falls back to the last non-`vercel.com` URL, and
canary-checks that URL unless a canary URL or command is configured.
