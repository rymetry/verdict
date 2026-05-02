# Rule: Autonomy Safety

Autonomous work must stop rather than guess when the next action can cause
irreversible project damage.

Stop conditions:

- CI or required checks are red.
- AI review reports P0/P1 issues.
- Scope checks fail.
- The same task fails three times.
- Tool authentication or network failure prevents verification.
- Production deploy needs approval and no approval token is present.

Do not commit secrets or `.agents/state/`.
