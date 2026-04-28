import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";

/**
 * Allure 3 result file schema (Phase 1.2 / T202).
 *
 * Each `*-result.json` in `allure-results/` corresponds to one test result.
 * Schema is intentionally lenient (`.passthrough()` on optional sub-objects,
 * `.optional()` on most fields) so that minor format drift between
 * `allure-playwright` versions does not break parsing for the Workbench side.
 * Fields the Workbench actually consumes (`status`, `name`/`fullName`,
 * `start`/`stop`, `statusDetails`) are pinned tighter.
 *
 * Validated against `allure-playwright@3.7.x` output. Fields like `historyId`,
 * `testCaseId`, `parameters` exist but are not consumed in T202; they are
 * preserved via passthrough for forward-compat with T206 (history) and Phase
 * 5 (deeper failure review).
 */
const AllureLabelSchema = z
  .object({
    name: z.string(),
    value: z.string(),
  })
  .passthrough();

const AllureAttachmentSchema = z
  .object({
    name: z.string(),
    source: z.string(),
    type: z.string().optional(),
  })
  .passthrough();

const AllureStatusDetailsSchema = z
  .object({
    message: z.string().optional(),
    trace: z.string().optional(),
  })
  .passthrough();

export const AllureStatusEnum = z.enum([
  "passed",
  "failed",
  "broken",
  "skipped",
  "unknown",
]);

export type AllureStatus = z.infer<typeof AllureStatusEnum>;

export const AllureResultSchema = z
  .object({
    uuid: z.string(),
    fullName: z.string().optional(),
    name: z.string().optional(),
    status: AllureStatusEnum,
    stage: z.string().optional(),
    start: z.number().optional(),
    stop: z.number().optional(),
    labels: z.array(AllureLabelSchema).default([]),
    attachments: z.array(AllureAttachmentSchema).default([]),
    statusDetails: AllureStatusDetailsSchema.optional(),
  })
  .passthrough();

export type AllureResult = z.infer<typeof AllureResultSchema>;

export interface AllureResultsReadResult {
  results: AllureResult[];
  /**
   * Best-effort parse warnings. One warning per file that failed JSON.parse
   * or zod validation. The warning text contains the **basename only**
   * (path-redaction policy / Issue #27); the full directory path is never
   * embedded so structured logs and user-visible warnings do not leak the
   * internal `<runDir>` path.
   */
  warnings: string[];
}

/**
 * Per-file errors that should abort the whole read rather than skip-and-warn.
 * The skip-and-warn fallback is correct for *content* problems (one corrupted
 * result file should not poison the rest) but is wrong for *process-level*
 * problems: a `EMFILE` (file-descriptor exhaustion) means the next read will
 * fail too, and re-emitting near-identical warnings hides the real issue. A
 * `EACCES` means the operator must intervene; warning-and-continue masks the
 * misconfiguration. A `EIO` (disk fault) similarly cannot be recovered by
 * trying the next file. We let these propagate so the caller's
 * `artifactKind: "allure-results"` + `op: "summary-extract"` log surfaces a
 * single, actionable error.
 */
const FATAL_READ_CODES = new Set(["EMFILE", "ENFILE", "EACCES", "EIO"]);

/**
 * Reads all `*-result.json` files from an `allure-results` directory and
 * parses each via {@link AllureResultSchema}.
 *
 * - Empty directory: returns `{ results: [], warnings: [] }` (caller may
 *   treat this as "no Allure data" and skip provider entirely).
 * - **Missing directory throws.** This is a deliberate caller contract:
 *   the underlying `fs.readdir` ENOENT carries the absolute directory path
 *   in `error.message`. Callers (provider → runManager) MUST wrap this
 *   with `errorLogFields(error)` (`apps/agent/src/lib/structuredLog.ts`,
 *   fail-closed default drops `error.message`) and emit the structured
 *   log with `artifactKind: "allure-results"` + `op: "summary-extract"`
 *   per the Issue #31 axes. Failing to do so leaks the absolute path
 *   through any logger that prints `error.message` (Issue #27 boundary).
 * - **Process-level read failures (EMFILE/ENFILE/EACCES/EIO) propagate** —
 *   skip-and-warn would either flood warnings (FD exhaustion) or hide an
 *   operator-action condition. Caller logs once with the redacted shape.
 * - Per-file *content* failures (ENOENT race, JSON syntax, zod validation)
 *   append a basename-only warning, continue with the remaining files.
 *   A single corrupted result file should not poison the whole report.
 *
 * The function does not log anything itself; it returns warnings as an
 * array so the caller (provider / runManager) attaches the run-scoped
 * structured-log context with `runId` / `op: "summary-extract"`.
 */
export async function readAllureResults(
  allureResultsDir: string
): Promise<AllureResultsReadResult> {
  const entries = await fs.readdir(allureResultsDir, { withFileTypes: true });
  const resultFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith("-result.json"))
    .map((e) => e.name);

  const results: AllureResult[] = [];
  const warnings: string[] = [];

  for (const filename of resultFiles) {
    const fullPath = path.join(allureResultsDir, filename);
    let raw: string;
    try {
      raw = await fs.readFile(fullPath, "utf8");
    } catch (error) {
      // Inner error message can embed `/Users/...`; we surface only the
      // filename + a stable error code so log aggregators / user-visible
      // warnings cannot leak the absolute path.
      const code =
        error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code
          : "READ_FAILED";
      // Process-level failures propagate; content-level failures (ENOENT
      // race etc) fall through to skip-and-warn.
      if (FATAL_READ_CODES.has(code)) {
        throw error;
      }
      warnings.push(`Allure result file ${filename} could not be read. code=${code}`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // JSON.parse only ever throws SyntaxError. If something else lands
      // here (e.g. future code change passes a non-string accidentally),
      // surface it rather than silently labelling it a JSON syntax issue.
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      warnings.push(`Allure result file ${filename} is not valid JSON.`);
      continue;
    }

    const validated = AllureResultSchema.safeParse(parsed);
    if (!validated.success) {
      // Include zod issue paths (field names like `status`, `labels.0.name`)
      // so future debugging knows *which* field failed validation. zod
      // issue paths never contain filesystem paths, so this is safe under
      // the path-redaction policy (Issue #27).
      const issuePaths = validated.error.issues
        .map((i) => i.path.join("."))
        .filter((s) => s.length > 0)
        .join(",");
      const detail = issuePaths.length > 0 ? ` issues=${issuePaths}` : "";
      warnings.push(
        `Allure result file ${filename} did not match the expected schema.${detail}`
      );
      continue;
    }

    results.push(validated.data);
  }

  return { results, warnings };
}
