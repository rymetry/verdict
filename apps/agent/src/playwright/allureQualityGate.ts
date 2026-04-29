import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import type { QualityGateProfile, QualityGateResult } from "@pwqa/shared";
import type { CommandRunner } from "../commands/runner.js";

/**
 * Phase 1.2 / T205-2: subprocess wrapper around `allure quality-gate`.
 *
 * Invokes the Allure CLI's quality-gate subcommand against the
 * run-scoped `allure-results/` directory and persists the outcome to
 * `<runDir>/quality-gate-result.json` per PLAN.v2 §23.
 *
 * Failure-mode taxonomy (parallel to allureReportGenerator.ts):
 *   - `"binary-missing"`: pre-check found no `node_modules/.bin/allure`.
 *   - `"timeout"`: spawned, exceeded `timeoutMs`.
 *   - `"exit-other"`: exit code ≠ 0 and ≠ 1. Allure docs pin
 *     `0 = passed`, `1 = quality gate failed`. Anything else is an
 *     error condition (e.g. malformed flags, internal CLI fault).
 *   - `"spawn-error"`: CommandRunner rejected before the binary spawned.
 *
 * Operator-action fatals (FATAL_OPERATIONAL_CODES) propagate, mirroring
 * the runArtifactsStore.ts (T203-2) and allureReportGenerator.ts (T204-3)
 * precedents.
 *
 * Status mapping (PLAN.v2 §23):
 *   - exit code 0 → status: "passed"
 *   - exit code 1 → status: "failed" (quality gate violated)
 *   - other → status: "error" (CLI fault or operational failure)
 *   - skipped path: status: "skipped" + warning + binary-missing
 */

const FATAL_OPERATIONAL_CODES = new Set([
  "EMFILE",
  "ENFILE",
  "EACCES",
  "EIO",
  "ENOSPC",
  "EDQUOT",
  "EROFS"
]);

export type AllureQualityGateFailureMode =
  | "binary-missing"
  | "timeout"
  | "exit-other"
  | "spawn-error";

export interface AllureQualityGateInput {
  /** Allure-policy CommandRunner. Wired by server.ts via
   *  `createAllureCommandPolicy(projectRoot)`. */
  runner: CommandRunner;
  /** Project root realpath (cwd for the subprocess). */
  projectRoot: string;
  /** Absolute path to `<runDir>/allure-results/` (the data the
   *  quality-gate evaluates). */
  allureResultsDest: string;
  /** Profile selection — used in the persisted JSON for QMO query. */
  profile: QualityGateProfile;
  /** Hard timeout in ms. Defaults to 30s — quality-gate is faster than
   *  generate. */
  timeoutMs?: number;
  /** When set, passed to the CLI as `--known-issues <path>`. Path is
   *  validated by the args policy (T205-1). */
  knownIssuesPath?: string;
  /** Optional numeric thresholds. Workbench may emit any combination
   *  per the chosen profile. Empty/undefined means CLI defaults. */
  rules?: {
    maxFailures?: number;
    minTestsCount?: number;
    successRate?: number;
    fastFail?: boolean;
  };
}

export interface AllureQualityGateOutcome {
  /** PLAN.v2 §23-conformant status. */
  status: QualityGateResult["status"];
  exitCode: number | null;
  durationMs: number;
  failureMode?: AllureQualityGateFailureMode;
  errorCode?: string;
  warnings: string[];
  /**
   * The persistable QualityGateResult model when the subprocess
   * actually ran (passed / failed / timed out / exit-other). Set to
   * undefined for skip paths (binary-missing, spawn-error) so the
   * caller knows there is nothing meaningful to persist.
   */
  persisted?: QualityGateResult;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const ALLURE_BIN_REL = path.join("node_modules", ".bin", "allure");

/**
 * Build the argv for `allure quality-gate`. Public for tests so the
 * deterministic shape can be pinned without spawning a process.
 */
export function buildQualityGateArgs(
  resultsDirRel: string,
  rules?: AllureQualityGateInput["rules"],
  knownIssuesRel?: string
): string[] {
  const args: string[] = ["quality-gate", resultsDirRel];
  if (rules?.maxFailures !== undefined) {
    args.push("--max-failures", String(rules.maxFailures));
  }
  if (rules?.minTestsCount !== undefined) {
    args.push("--min-tests-count", String(rules.minTestsCount));
  }
  if (rules?.successRate !== undefined) {
    args.push("--success-rate", String(rules.successRate));
  }
  if (rules?.fastFail) {
    args.push("--fast-fail");
  }
  if (knownIssuesRel) {
    args.push("--known-issues", knownIssuesRel);
  }
  return args;
}

export async function evaluateAllureQualityGate(
  input: AllureQualityGateInput
): Promise<AllureQualityGateOutcome> {
  const { runner, projectRoot, allureResultsDest, profile } = input;
  const allureBinAbs = path.join(projectRoot, ALLURE_BIN_REL);

  if (!fsSync.existsSync(allureBinAbs)) {
    return {
      status: "skipped",
      exitCode: null,
      durationMs: 0,
      failureMode: "binary-missing",
      warnings: [
        "Allure CLI not found at <projectRoot>/node_modules/.bin/allure; quality-gate skipped."
      ]
    };
  }

  const resultsDirRel = path.relative(projectRoot, allureResultsDest);
  const knownIssuesRel = input.knownIssuesPath
    ? path.relative(projectRoot, input.knownIssuesPath)
    : undefined;
  const args = buildQualityGateArgs(resultsDirRel, input.rules, knownIssuesRel);

  const startedAt = Date.now();
  const handle = runner.run({
    executable: allureBinAbs,
    args,
    cwd: projectRoot,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    label: "allure-quality-gate"
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
      status: "error",
      exitCode: null,
      durationMs: Date.now() - startedAt,
      failureMode: "spawn-error",
      errorCode: code ?? (error instanceof Error ? error.name : "UNKNOWN"),
      warnings: [
        `Allure quality-gate failed before exit. code=${code ?? (error instanceof Error ? error.name : "UNKNOWN")}`
      ]
    };
  }

  const durationMs = result.durationMs;
  // Allure CLI exit codes for quality-gate (T200 investigation):
  //   0 = pass, 1 = fail. Treat anything else as an error condition.
  let status: QualityGateResult["status"];
  let failureMode: AllureQualityGateFailureMode | undefined;
  let warnings: string[] = [];
  if (result.timedOut) {
    status = "error";
    failureMode = "timeout";
    warnings = [
      `Allure quality-gate timed out after ${input.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`
    ];
  } else if (result.exitCode === 0) {
    status = "passed";
  } else if (result.exitCode === 1) {
    status = "failed";
  } else {
    status = "error";
    failureMode = "exit-other";
    warnings = [
      `Allure quality-gate exited with unexpected code. exitCode=${result.exitCode ?? "null"}; signal=${result.signal ?? "null"}`
    ];
  }

  // Persist-ready QG result. Stdout/stderr are part of the schema
  // (PLAN.v2 §23 raw-first preservation policy) — written verbatim
  // into `<runDir>/quality-gate-result.json` by the caller. The file
  // lives in `.playwright-workbench/` (operator-controlled), not
  // shipped to log aggregators, so the path-redaction policy concerns
  // do not apply here in the same way as run-warning text.
  const persisted: QualityGateResult = {
    status,
    profile,
    evaluatedAt: new Date().toISOString(),
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    warnings
  };
  return {
    status,
    exitCode: result.exitCode,
    durationMs,
    failureMode,
    warnings,
    persisted
  };
}

/**
 * Persists the Quality Gate result JSON to `<runDir>/quality-gate-result.json`.
 * Pure I/O — separated from the runner so tests can drive each independently.
 */
export async function persistQualityGateResult(
  qualityGateResultPath: string,
  result: QualityGateResult
): Promise<void> {
  await fs.mkdir(path.dirname(qualityGateResultPath), { recursive: true });
  await fs.writeFile(qualityGateResultPath, JSON.stringify(result, null, 2), "utf8");
}

function errorCodeOf(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return undefined;
}
