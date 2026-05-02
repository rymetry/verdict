# Rule: Path Safety

**Status**: enforced (security-relevant)

Verdict's **Phase 1 PoC review** identified absolute-path leakage in API responses, QMO Markdown, and AI context as a recurring class of bug. This rule codifies the boundary contract.

## Why this matters

- Absolute paths leak the user's filesystem layout (`/Users/rym/Dev/...`), which is a privacy / OPSEC issue when:
  - Run artifacts are shared as a "Sharable Bundle" (Phase 2) with other roles or organizations.
  - QMO Markdown or AI context is pasted into a PR comment, Slack, or external tool.
  - LLM provider receives the AI context (the absolute path is exfiltrated outside the org).
- Self-hosted enterprise customers (financial, regulated) require this for compliance.

## The contract

| Boundary | Path representation | Notes |
|---|---|---|
| **Internal storage** (`metadata.json`, `quality-gate-result.json`, agent in-memory) | Absolute OK | Convenient for local file ops; not exposed |
| **`ProjectSummary.rootPath`** (response of `/projects/open`, `/projects/current`) | **Absolute** by design | This is the user's chosen root, not test/run output. The local control-plane needs the absolute path so that subsequent navigation, file resolution, and CLI invocation all share one canonical root. Verified by server tests that assert the absolute workdir. |
| **HTTP API responses** (everything else: failures, artifacts, evidence, run metadata path fields) | **Project-relative only**, plus optional `absolutePath?: string` for "open in OS" flows | Never required |
| **WebSocket payloads** | Project-relative only | Same as HTTP |
| **AI context** (sent to LLM) | Project-relative only, **absoluteFilePath strictly undefined** | Verified by `analysisContext.test.ts` |
| **QMO Markdown** (`qmo-summary.md`) | Project-relative only | The Markdown is meant to be shared |
| **Repair Review draft / GitHub PR comment** | Project-relative only | External-facing |
| **Failure Review UI surface** | Project-relative only | Cross-role view |
| **Audit log** (`audit.log`) | Absolute OK with `cwdHash` | Local diagnostic |

The `ProjectSummary.rootPath` exception is intentional: a *local* control plane communicating the *active* project to its own GUI is not the threat model that path-safety addresses. The threat model is **shareable / external surfaces** (PR comments, AI context, Bundle exports). Run-scoped path fields inside those payloads stay relative even though `rootPath` itself is absolute.

## How to comply

1. When introducing or modifying a payload schema in `packages/shared`, name path fields explicitly:
   - `relativeFilePath: string` (required at API boundary)
   - `absoluteFilePath?: string` (optional, for OS-open helpers only)
2. At every serializer that emits to an external boundary, run paths through `projectRelativePath(filePath, projectRoot)` (defined in `apps/agent/src/reporting/failureReview.ts` and `apps/agent/src/ai/analysisContext.ts`).
3. The helper must return `undefined` for:
   - Paths containing `..` segments (traversal escape attempts).
   - Paths outside the project root after resolution.
4. When the helper returns `undefined`, fall back to `safeDisplayPath()` which returns the basename — never the raw absolute path.
5. If you write a new serializer, write a test that asserts the output JSON / Markdown does not contain `/Users/`, `C:\`, or absolute path patterns when given absolute-path input.

## Forbidden

- Returning `path.resolve(...)` results directly from a Hono route handler.
- Logging absolute paths to `console.error` / `pino.error` without `cwdHash` redaction.
- Including `absoluteFilePath` in the AI context payload (must always be `undefined`).
- Using `path.basename` as a "fallback" without first attempting `projectRelativePath` — basename loses too much information when relative is achievable.

## Reference implementation

- `apps/agent/src/reporting/failureReview.ts` — reference for serializer path normalization with traversal guards.
- `apps/agent/src/ai/analysisContext.ts` — reference for AI-context-specific stricter handling.
- `apps/agent/test/aiAnalysisContext.test.ts` (`drops traversal relative paths from AI context`) — load-bearing security assertion. Adopt this test pattern for any new path-handling code.

## Reviewer checklist

When reviewing a PR that adds or modifies a payload-emitting code path:

- [ ] Does the schema in `packages/shared` distinguish `relativeFilePath` and `absoluteFilePath`?
- [ ] Does the serializer call `projectRelativePath` with the project root?
- [ ] Are `..` traversal inputs handled (returns `undefined`, not the raw path)?
- [ ] Is there a test asserting absolute paths are not present in the output?
- [ ] If this is an AI-context path, is `absoluteFilePath` strictly `undefined`?
