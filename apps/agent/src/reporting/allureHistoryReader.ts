import * as fs from "node:fs/promises";
import {
  AllureHistoryEntrySchema,
  type AllureHistoryEntry
} from "@pwqa/shared";

/**
 * §1.3 Allure history JSONL reader.
 *
 * Reads `<projectRoot>/.playwright-workbench/reports/allure-history.jsonl`
 * and yields validated `AllureHistoryEntry` records plus a list of
 * warnings for lines that could not be parsed or did not validate.
 *
 * Robustness contract (PoC-grade graceful degrade):
 *   - File missing → empty entries / no warning. The GUI shows "no trend
 *     yet" rather than an error. This is the normal state for a project
 *     that has not run twice with Allure enabled.
 *   - Per-line JSON parse failure → warning + skip. One corrupt line must
 *     not poison the whole trend.
 *   - Per-line zod failure → warning + skip. Forward-compat with older
 *     Allure versions whose entries lack required fields.
 *   - Process-level read failure (EACCES / EIO / EMFILE / ENFILE)
 *     → propagate. These are operator-action conditions; silently
 *     swallowing them would defeat ops observability.
 *   - Oversized file → return empty + warning. JSONL append-only; in
 *     practice <1 MiB even after dozens of runs, but cap to avoid
 *     unbounded memory under pathological writers.
 */

const MAX_FILE_BYTES = 16 * 1024 * 1024; // 16 MiB
const MAX_ENTRIES = 5_000;

const FATAL_OPERATIONAL_CODES = new Set([
  "EMFILE",
  "ENFILE",
  "EACCES",
  "EIO",
  "ENOSPC",
  "EDQUOT",
  "EROFS",
]);

export interface AllureHistoryReadResult {
  entries: AllureHistoryEntry[];
  warnings: string[];
}

function errorCodeOf(error: unknown): string {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "UNKNOWN";
}

export async function readAllureHistory(
  historyPath: string
): Promise<AllureHistoryReadResult> {
  let stat;
  try {
    stat = await fs.stat(historyPath);
  } catch (error) {
    const code = errorCodeOf(error);
    if (code === "ENOENT") {
      return { entries: [], warnings: [] };
    }
    if (FATAL_OPERATIONAL_CODES.has(code)) {
      throw error;
    }
    return {
      entries: [],
      warnings: [`Allure history could not be opened. code=${code}`],
    };
  }

  if (stat.size > MAX_FILE_BYTES) {
    return {
      entries: [],
      warnings: [
        `Allure history exceeds ${MAX_FILE_BYTES} bytes; truncating to keep memory bounded.`,
      ],
    };
  }

  let raw: string;
  try {
    raw = await fs.readFile(historyPath, "utf8");
  } catch (error) {
    const code = errorCodeOf(error);
    if (FATAL_OPERATIONAL_CODES.has(code)) {
      throw error;
    }
    return {
      entries: [],
      warnings: [`Allure history could not be read. code=${code}`],
    };
  }

  const lines = raw.split("\n");
  const entries: AllureHistoryEntry[] = [];
  const warnings: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (line.trim().length === 0) continue;
    if (entries.length >= MAX_ENTRIES) {
      warnings.push(
        `Allure history has more than ${MAX_ENTRIES} entries; remainder ignored.`
      );
      break;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      warnings.push(
        `Allure history line ${lineIndex + 1} is not valid JSON; skipped.`
      );
      continue;
    }
    const result = AllureHistoryEntrySchema.safeParse(normalizeAllureHistoryEntry(parsed));
    if (!result.success) {
      warnings.push(
        `Allure history line ${lineIndex + 1} did not match schema; skipped. issues=${result.error.issues
          .map((i) => i.code)
          .join(",")}`
      );
      continue;
    }
    entries.push(result.data);
  }

  return { entries, warnings };
}

function normalizeAllureHistoryEntry(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  const entry = { ...(parsed as Record<string, unknown>) };
  if (entry.generatedAt === undefined) {
    const timestamp = entry.timestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
      entry.generatedAt = new Date(timestamp).toISOString();
    } else if (typeof timestamp === "string" && timestamp.length > 0) {
      const millis = Number(timestamp);
      entry.generatedAt = Number.isFinite(millis)
        ? new Date(millis).toISOString()
        : timestamp;
    }
  }

  if (
    entry.testResults &&
    typeof entry.testResults === "object" &&
    !Array.isArray(entry.testResults)
  ) {
    const results = Object.values(entry.testResults as Record<string, unknown>);
    let passed = 0;
    let failed = 0;
    let broken = 0;
    let skipped = 0;
    let unknown = 0;
    for (const result of results) {
      const status =
        result && typeof result === "object" && "status" in result
          ? (result as { status?: unknown }).status
          : undefined;
      if (status === "passed") passed += 1;
      else if (status === "failed") failed += 1;
      else if (status === "broken") broken += 1;
      else if (status === "skipped") skipped += 1;
      else unknown += 1;
    }
    entry.total ??= results.length;
    entry.passed ??= passed;
    entry.failed ??= failed + broken;
    entry.broken ??= broken;
    entry.skipped ??= skipped;
    entry.unknown ??= unknown;
  }

  return entry;
}
