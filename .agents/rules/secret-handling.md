# Rule: Secret Handling

**Status**: enforced (security-critical)

Secrets in Verdict's context include: AI provider API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), GitHub PATs, `~/.codex/auth.json`, Stripe / DocuSign / SendGrid sandbox keys (in user fixtures), and user-supplied storageState/cookie values during exploration.

## Hard rules

1. **Never log a secret value.** Use the redactor under `apps/agent/src/commands/redact.ts` (one-shot redaction) or `apps/agent/src/playwright/streamRedactor.ts` (run streaming). Streaming paths must always go through the stream redactor; one-shot logs may opt-in.
2. **Never persist a secret in a run artifact.** `metadata.json`, `*.log`, `quality-gate-result.json`, AI context, QMO Markdown — none of these are allowed to contain raw API keys.
3. **Never include `process.env` wholesale in a CommandRunner env.** Pass an explicit allowlist; the runner adds `PATH` / `HOME` by default.
4. **Never echo a secret back to the user prompt.** If an error message would include a secret, redact before throwing.
5. **Never commit `.env`, `auth.json`, `*.key`, `*.pem`, or files matching the gitleaks default rules.** The `.gitignore` excludes the common ones; double-check on each PR.
6. **storageState / cookie content is treated as secret.** Phase 1's exploration adapter must not log cookie values; it logs only domain + cookie name.

## Pattern: customer-managed API keys

For LLM providers, Verdict expects the customer to **bring their own key** via env var. The agent does:

```ts
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error("ANTHROPIC_API_KEY is not configured. See docs/operations/poc-guide.md.");
}
```

The key is forwarded to the AI CLI subprocess via the env allowlist:

```ts
runner.run({
  executable: "claude",
  args: [...],
  env: {
    PATH: process.env.PATH!,
    ANTHROPIC_API_KEY: apiKey,
  },
});
```

The CommandRunner does not echo the env to the audit log; it stores the env keys (not values) only.

## Forbidden

- `console.log(req.body)` or `console.log(env)` in production paths.
- Persisting raw stdout to `<runDir>/stdout.log` without first running it through the streaming redactor — `apps/agent/src/playwright/runManager.ts` does this; new run paths must follow.
- Returning an error message that contains a secret. Use stable error codes (`AI_CLI_AUTH`, `AI_CLI_QUOTA`) instead.
- Treating a Stripe test card or DocuSign sandbox key as "non-secret". The fixture data may be public, but the same code path also runs in customer environments.

## When you find a leak

1. Stop the offending PR. Mark it as not mergeable.
2. If the secret reached an external surface (PR comment, logs uploaded to CI, AI provider request), assume rotation is required.
3. Open a Security Advisory via `https://github.com/rymetry/verdict/security/advisories/new` per `SECURITY.md`. Do not file a public issue.

## Reviewer checklist

- [ ] Does any new logging path emit raw stdin/stdout that may contain secrets?
- [ ] Is the env in any new CommandRunner call explicit (allowlist) rather than spread `process.env`?
- [ ] Are storageState / cookie / authorization headers redacted in any new exploration code?
- [ ] If the PR adds a new env var, is it documented in `docs/operations/poc-guide.md`?
