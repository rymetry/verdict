import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import type { CommandRunner } from "../commands/runner.js";

const FATAL_OPERATIONAL_CODES = new Set([
  "EMFILE",
  "ENFILE",
  "EACCES",
  "EIO",
  "ENOSPC",
  "EDQUOT",
  "EROFS"
]);

const DEFAULT_TIMEOUT_MS = 30_000;
const ALLURE_BIN_REL = path.join("node_modules", ".bin", "allure");

export type AllureSupplementalFailureMode =
  | "binary-missing"
  | "timeout"
  | "exit-nonzero"
  | "spawn-error"
  | "persist-error";

export interface AllureSupplementalOutcome {
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  failureMode?: AllureSupplementalFailureMode;
  errorCode?: string;
  warnings: string[];
}

interface BaseInput {
  runner: CommandRunner;
  projectRoot: string;
  allureResultsDest: string;
  timeoutMs?: number;
}

export interface GenerateAllureHistoryInput extends BaseInput {
  historyPath: string;
}

export interface ExportAllureCsvInput extends BaseInput {
  csvPath: string;
}

export interface ExportAllureLogInput extends BaseInput {
  logPath: string;
}

export interface GenerateKnownIssuesInput extends BaseInput {
  knownIssuesPath: string;
}

export async function generateAllureHistory(
  input: GenerateAllureHistoryInput
): Promise<AllureSupplementalOutcome> {
  await fs.mkdir(path.dirname(input.historyPath), { recursive: true });
  const resultsDirRel = path.relative(input.projectRoot, input.allureResultsDest);
  const historyPathRel = path.relative(input.projectRoot, input.historyPath);
  return runAllureSupplementalCommand(input, {
    args: ["history", "--history-path", historyPathRel, resultsDirRel],
    label: "allure-history",
    warningPrefix: "Allure history export"
  });
}

export async function exportAllureCsv(
  input: ExportAllureCsvInput
): Promise<AllureSupplementalOutcome> {
  await fs.mkdir(path.dirname(input.csvPath), { recursive: true });
  const resultsDirRel = path.relative(input.projectRoot, input.allureResultsDest);
  const csvPathRel = path.relative(input.projectRoot, input.csvPath);
  return runAllureSupplementalCommand(input, {
    args: ["csv", resultsDirRel, "-o", csvPathRel],
    label: "allure-csv",
    warningPrefix: "Allure CSV export"
  });
}

export async function exportAllureLog(
  input: ExportAllureLogInput
): Promise<AllureSupplementalOutcome> {
  const resultsDirRel = path.relative(input.projectRoot, input.allureResultsDest);
  const outcome = await runAllureSupplementalCommand(input, {
    args: ["log", resultsDirRel],
    label: "allure-log",
    warningPrefix: "Allure log export",
    captureStdoutPath: input.logPath
  });
  return outcome;
}

export async function generateKnownIssues(
  input: GenerateKnownIssuesInput
): Promise<AllureSupplementalOutcome> {
  await fs.mkdir(path.dirname(input.knownIssuesPath), { recursive: true });
  const resultsDirRel = path.relative(input.projectRoot, input.allureResultsDest);
  const knownIssuesRel = path.relative(input.projectRoot, input.knownIssuesPath);
  return runAllureSupplementalCommand(input, {
    args: ["known-issue", resultsDirRel, "-o", knownIssuesRel],
    label: "allure-known-issue",
    warningPrefix: "Allure known-issues export"
  });
}

async function runAllureSupplementalCommand(
  input: BaseInput,
  options: {
    args: string[];
    label: string;
    warningPrefix: string;
    captureStdoutPath?: string;
  }
): Promise<AllureSupplementalOutcome> {
  const allureBinAbs = path.join(input.projectRoot, ALLURE_BIN_REL);
  if (!fsSync.existsSync(allureBinAbs)) {
    return {
      ok: false,
      failureMode: "binary-missing",
      exitCode: null,
      durationMs: 0,
      warnings: [
        `Allure CLI not found at <projectRoot>/node_modules/.bin/allure; ${options.warningPrefix} skipped.`
      ]
    };
  }

  const startedAt = Date.now();
  const handle = input.runner.run({
    executable: allureBinAbs,
    args: options.args,
    cwd: input.projectRoot,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    label: options.label
  });

  let result;
  try {
    result = await handle.result;
  } catch (error) {
    const code = errorCodeOf(error);
    if (code && FATAL_OPERATIONAL_CODES.has(code)) {
      throw error;
    }
    return {
      ok: false,
      failureMode: "spawn-error",
      errorCode: code ?? (error instanceof Error ? error.name : "UNKNOWN"),
      exitCode: null,
      durationMs: Date.now() - startedAt,
      warnings: [
        `${options.warningPrefix} failed before exit. code=${code ?? (error instanceof Error ? error.name : "UNKNOWN")}`
      ]
    };
  }

  if (result.exitCode === 0 && !result.timedOut) {
    if (options.captureStdoutPath) {
      try {
        await fs.mkdir(path.dirname(options.captureStdoutPath), { recursive: true });
        await fs.writeFile(options.captureStdoutPath, result.stdout, "utf8");
      } catch (error) {
        const code = errorCodeOf(error) ?? "UNKNOWN";
        if (FATAL_OPERATIONAL_CODES.has(code)) {
          throw error;
        }
        return {
          ok: false,
          failureMode: "persist-error",
          errorCode: code,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          warnings: [
            `${options.warningPrefix} could not be persisted. code=${code}`
          ]
        };
      }
    }
    return {
      ok: true,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      warnings: []
    };
  }

  if (result.timedOut) {
    return {
      ok: false,
      failureMode: "timeout",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      warnings: [
        `${options.warningPrefix} timed out after ${input.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`
      ]
    };
  }

  return {
    ok: false,
    failureMode: "exit-nonzero",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    warnings: [
      `${options.warningPrefix} failed. exitCode=${result.exitCode ?? "null"}; signal=${result.signal ?? "null"}`
    ]
  };
}

function errorCodeOf(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}
