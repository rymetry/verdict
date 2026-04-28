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
 * Reads all `*-result.json` files from an `allure-results` directory and
 * parses each via {@link AllureResultSchema}.
 *
 * - Empty directory: returns `{ results: [], warnings: [] }` (caller may
 *   treat this as "no Allure data" and skip provider entirely).
 * - Missing directory: throws (caller logs the read failure with
 *   `artifactKind: "allure-results"` per the Issue #31 axis convention).
 * - Per-file parse failure: appends a basename-only warning, continues with
 *   the remaining files. Best-effort: a single corrupted result file should
 *   not poison the whole report.
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
      const code = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "READ_FAILED";
      warnings.push(`Allure result file ${filename} could not be read. code=${code}`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      warnings.push(`Allure result file ${filename} is not valid JSON.`);
      continue;
    }

    const validated = AllureResultSchema.safeParse(parsed);
    if (!validated.success) {
      warnings.push(`Allure result file ${filename} did not match the expected schema.`);
      continue;
    }

    results.push(validated.data);
  }

  return { results, warnings };
}
