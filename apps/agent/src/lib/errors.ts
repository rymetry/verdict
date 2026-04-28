/**
 * Raised when audit persistence fails in fail-closed mode. Keeping this as a
 * typed error lets HTTP routing classify the failure without exposing raw paths.
 */
export class AuditPersistenceError extends Error {
  readonly code = "AUDIT_PERSIST_FAILED" as const;

  constructor(cause: unknown) {
    super("Audit persistence failed", { cause });
    this.name = "AuditPersistenceError";
  }
}
