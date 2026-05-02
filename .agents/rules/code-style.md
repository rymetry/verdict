# Rule: Code Style

**Status**: enforced

Project-wide TypeScript / JavaScript code style for Verdict. Rooted in the user's global `coding-style.md` (immutability, small files, comprehensive errors) but tuned for this monorepo.

## Mandatory

### TypeScript
- `strict: true` everywhere. Never disable in `tsconfig`.
- **No `any`** in application code. Use `unknown` for untrusted input, then narrow safely. Generics for caller-driven types.
- Public APIs (exports across files) must have explicit parameter and return types. Local variables can rely on inference.
- Prefer `interface` for object shapes that may be extended; `type` for unions, intersections, mapped types.
- Prefer string-literal unions over `enum` unless interop forces otherwise.

### Immutability (CRITICAL)
- Never mutate inputs. Construct new objects/arrays. `const result = { ...prev, field: value }`.
- Mark cross-file shared structures `Readonly<T>` / `ReadonlyArray<T>` where they should not be mutated by consumers.
- Zod schemas should not be re-exported with mutation hooks; clone if a variant is needed.

### File organization
- Many small files > few large ones. Aim for 200-400 lines per file; 800 is the hard ceiling.
- Co-locate by feature/domain, not by type.
- Extract pure helpers when a function exceeds ~50 lines or has 3+ reasons to change.

### Comments
- Default to **no comment**. Identifiers should explain the *what*.
- Add a comment only when the *why* is non-obvious: hidden invariant, regulatory constraint, surprising platform behavior.
- Never write comments that reference current PR / Slack / issue numbers; those rot. Reference durable artifacts (RFC, PLAN.v3 sec x.y, security review note) instead.

### Error handling
- Validate at system boundaries (HTTP body, env vars, file content) with Zod or equivalent.
- Inside a trusted module boundary, trust the caller and rely on the type system — do not re-validate.
- Never silently swallow errors. Either log + structured throw, or propagate. The user-global rule "Never silently swallow errors" is binding.
- Prefer typed errors with stable `code` strings (`AI_CLI_NOT_FOUND` etc.) over `instanceof` chains.
- For UI/Markdown/AI surfaces, redact stack traces and absolute paths via the existing redaction layer.

### React (apps/web)
- Components are functions. No `React.FC`.
- Props as named `interface`. Callbacks typed explicitly.
- Hooks: return stable identity (`useCallback`, `useMemo`) only when downstream effects depend on it.
- TanStack Query is the data layer; do not fetch in `useEffect`.
- shadcn/ui primitives are the visual layer; do not re-implement them.
- All structured run / failure / artifact data flows through Zod-validated API responses.

### Node Agent (apps/agent)
- Hono router. Routes return `c.json(payload)` where `payload` matches a Zod schema in `packages/shared`.
- Use `pino` for logs; never `console.log` in production paths (the codebase ships with `console` allowed but only for dev / test plumbing).
- File I/O goes through the existing storage layer (`apps/agent/src/storage/`), not raw `fs.writeFile`.

## Forbidden

- `any` (use `unknown` and narrow)
- Mutation of function arguments
- Dynamic code execution from strings (avoid evaluators that take user input as code)
- Deeply nested ternaries; extract to a named function instead
- Re-exporting types from third-party libs as our own without a thin wrapper

## Enforcement
- `pnpm typecheck` must pass on every PR.
- The `post-tool-use-typecheck.sh` hook flags type drift on `Edit`/`Write` of `.ts`/`.tsx`.
- The user-global hooks (Prettier, console.log audit) still apply via Claude Code / Codex defaults.

## Where rules belong: prose vs. lint

Statically-checkable invariants belong in the toolchain, not in this file.
Before adding a new line of prose to `.agents/rules/`, ask: "could this be
expressed as a lint rule instead?" If yes, write the lint rule.

| Belongs in TypeScript / ESLint / ast-grep / a hook | Belongs in this file (prose) |
|---|---|
| "no `any`", "no unused imports", "no relative imports across packages" | Why immutability matters and which patterns we accept |
| Locator-policy violations (`xpath=...`), forbidden API names | What makes a test maintainable in this codebase |
| File-size cap (max 800 lines/file) | When to extract a helper vs. inline a function |
| Import order, attribute order in JSX | The reasoning behind schema-first |

Prose rules are for **judgment, principles, and contracts that change with
context**. They are expensive to read and easy to drift; reserve them for
guidance that no static analyzer can express. Whenever the prose says
"prefer X over Y" and X / Y are syntactically distinguishable, file an
issue to migrate it to a lint rule and remove it from the prose set.

This is not optional: prose rules that *could* be lint rules are a
maintenance bug. They get out of sync with the codebase silently and
mislead agents into citing them as gospel when reviewers have already
moved on.
