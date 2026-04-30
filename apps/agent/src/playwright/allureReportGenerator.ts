import * as fsSync from "node:fs";
import * as path from "node:path";
import type { CommandRunner } from "../commands/runner.js";

/**
 * Phase 1.2 / T204-3: subprocess wrapper around `allure generate` for HTML
 * report production. Lives in the playwright domain because it's part of
 * the run lifecycle (post-test-execution, post-allure-results-copy) but
 * doesn't belong to `RunArtifactsStore` (SRP — store handles file
 * operations, this helper handles subprocess invocation through the
 * security-bounded CommandRunner).
 *
 * The function does not log anything itself; it returns a structured
 * outcome so the caller (RunManager lifecycle hook) attaches the
 * run-scoped context (`runId`, `artifactKind: "allure-report"`).
 *
 * Failure-mode taxonomy (returned via `failureMode`):
 *   - `"binary-missing"`: pre-check found no `node_modules/.bin/allure`.
 *     No subprocess was spawned. Operator must `pnpm install` Allure.
 *   - `"timeout"`: spawned, exceeded `timeoutMs`. Inspect run-size /
 *     allure CLI version.
 *   - `"exit-nonzero"`: spawned, exited with non-zero exit code. Caller
 *     should look at the run's allure-results dir size — empty results
 *     are the dominant cause; T204 review found Allure CLI prints a
 *     misleading exit code in that case.
 *   - `"spawn-error"`: CommandRunner rejected before the binary spawned
 *     (policy rejection, FD exhaustion, etc). Includes `errorCode` from
 *     the rewrapped Error.
 *   - undefined when `ok === true`.
 *
 * Operator-action fatals (EACCES on the binary, EMFILE/ENFILE during
 * spawn, EIO on the cwd realpath, EROFS, ENOSPC, EDQUOT) do NOT swallow
 * into a generic warning — the helper re-throws so the caller's
 * structured log surfaces a single actionable error rather than burying
 * it in `metadata.warnings`. Mirrors the
 * `runArtifactsStore.ts` `FATAL_OPERATIONAL_CODES` policy (T203-2).
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

export type AllureGenerateFailureMode =
  | "binary-missing"
  | "timeout"
  | "exit-nonzero"
  | "spawn-error";

export interface AllureGenerateOutcome {
  /** True when the subprocess exited cleanly (exit code 0). */
  ok: boolean;
  /** Subprocess exit code; null when the binary was missing or the
   *  process was killed by signal. */
  exitCode: number | null;
  /** Wall-clock duration of the subprocess invocation. Always defined
   *  even on error so operators can spot timeouts vs. fast failures. */
  durationMs: number;
  /** Stable failure-mode discriminator for structured log facets. Set
   *  iff `ok === false`. */
  failureMode?: AllureGenerateFailureMode;
  /** Inner error code when failureMode === "spawn-error". Forwarded so
   *  log aggregator queries can distinguish e.g. policy rejection from
   *  ENOENT race (binary removed mid-call). */
  errorCode?: string;
  /** Absolute path to the generated report directory. Set only when
   *  ok=true. */
  reportPath?: string;
  /** Path-redacted operational warnings (basenames + stable codes only).
   *  Caller emits the structured log entry with the run context. */
  warnings: string[];
}

export interface GenerateAllureReportInput {
  /** Allure-policy CommandRunner. Built by server.ts via
   *  `createAllureCommandPolicy(projectRoot)`. When undefined the caller
   *  should skip the lifecycle hook entirely (test environments, CLI
   *  not available). */
  runner: CommandRunner;
  /** Project root realpath. Used both as `cwd` for the subprocess and
   *  as the base for converting absolute paths to project-relative. */
  projectRoot: string;
  /** Run-scoped absolute path to `<runDir>/allure-results/`. Source for
   *  Allure to read. */
  allureResultsDest: string;
  /** Run-scoped absolute path to `<runDir>/allure-report/`. Destination
   *  for the generated HTML. */
  allureReportDir: string;
  /** Hard timeout in ms. Defaults to 60s — Allure HTML generation is
   *  typically a few seconds; 60s gives slack for very large suites
   *  while bounding the worst-case wait. */
  timeoutMs?: number;
  /**
   * Phase 1.2 / T206: reserved project-scoped history path. Allure 3.6's
   * `generate` command does not accept `--history-path`, so RunManager keeps
   * this as an explicit input for the later history writer without passing it
   * to the CLI.
   */
  historyPath?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const ALLURE_BIN_REL = path.join("node_modules", ".bin", "allure");

/**
 * Run `allure generate <results-dir> -o <report-dir>` against the
 * project's local Allure CLI. Returns a path-redacted outcome describing
 * success or the structured failure mode.
 *
 * Skip path: if `<projectRoot>/node_modules/.bin/allure` does not exist,
 * returns `ok: false` immediately with a single warning. No subprocess
 * is spawned. This matches the just-in-time installation policy of T200
 * (Allure CLI is project-local, not global).
 */
export async function generateAllureReport(
  input: GenerateAllureReportInput
): Promise<AllureGenerateOutcome> {
  const { runner, projectRoot, allureResultsDest, allureReportDir } = input;
  const allureBinAbs = path.join(projectRoot, ALLURE_BIN_REL);

  // Pre-check: avoid spawning if the binary is missing. The CommandRunner
  // would also fail with ENOENT (different error shape), but a structured
  // warning here is more actionable for the operator ("install allure"
  // vs "spawn failed code=ENOENT"). The warning text contains the literal
  // placeholder `<projectRoot>` rather than the absolute path so log
  // aggregators do not leak the user's filesystem layout.
  if (!fsSync.existsSync(allureBinAbs)) {
    return {
      ok: false,
      failureMode: "binary-missing",
      exitCode: null,
      durationMs: 0,
      warnings: [
        "Allure CLI not found at <projectRoot>/node_modules/.bin/allure; HTML report generation skipped."
      ]
    };
  }

  // Convert absolute paths to project-relative so the validator's
  // path-traversal/absolute checks accept them. The validator pins
  // project-relative form to ensure the subprocess can never write
  // outside the workbench dir.
  const resultsDirRel = path.relative(projectRoot, allureResultsDest);
  const reportDirRel = path.relative(projectRoot, allureReportDir);
  const args: string[] = [
    "generate",
    resultsDirRel,
    "-o",
    reportDirRel
  ];

  const startedAt = Date.now();
  const handle = runner.run({
    executable: allureBinAbs,
    args,
    cwd: projectRoot,
    timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    label: "allure-generate"
  });

  let result;
  try {
    result = await handle.result;
  } catch (error) {
    const code = errorCodeOf(error);
    // Operator-action fatals propagate. The caller's run lifecycle
    // surfaces ONE structured error log rather than letting hundreds
    // of identical "spawn failed" warnings accumulate over a flapping
    // FD exhaustion or disk-full condition. Mirrors T203-2 review fix
    // for the same anti-pattern in runArtifactsStore.ts.
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
        `Allure HTML report generation failed before exit. code=${code ?? (error instanceof Error ? error.name : "UNKNOWN")}`
      ]
    };
  }

  const durationMs = result.durationMs;
  const ok = result.exitCode === 0;
  if (ok) {
    return {
      ok: true,
      exitCode: result.exitCode,
      durationMs,
      reportPath: allureReportDir,
      warnings: []
    };
  }

  if (result.timedOut) {
    return {
      ok: false,
      failureMode: "timeout",
      exitCode: result.exitCode,
      durationMs,
      warnings: [
        `Allure HTML report generation timed out after ${input.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`
      ]
    };
  }
  return {
    ok: false,
    failureMode: "exit-nonzero",
    exitCode: result.exitCode,
    durationMs,
    warnings: [
      `Allure HTML report generation failed. exitCode=${result.exitCode ?? "null"}; signal=${result.signal ?? "null"}`
    ]
  };
}

function errorCodeOf(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return undefined;
}
