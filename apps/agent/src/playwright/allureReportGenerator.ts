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
 */

export interface AllureGenerateOutcome {
  /** True when the subprocess exited cleanly (exit code 0). */
  ok: boolean;
  /** Subprocess exit code; null when the binary was missing or the
   *  process was killed by signal. */
  exitCode: number | null;
  /** Wall-clock duration of the subprocess invocation. Always defined
   *  even on error so operators can spot timeouts vs. fast failures. */
  durationMs: number;
  /** Captured stdout (verbatim — caller is responsible for redaction
   *  when persisting). */
  stdout: string;
  /** Captured stderr (verbatim). */
  stderr: string;
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
}

const DEFAULT_TIMEOUT_MS = 60_000;
const ALLURE_BIN_REL = path.join("node_modules", ".bin", "allure");

/**
 * Run `allure generate <results-dir> -o <report-dir> --clean` against the
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
  // would also fail (different error shape), but a structured warning here
  // is more actionable for the operator ("install allure" vs "spawn
  // failed code=ENOENT").
  if (!fsSync.existsSync(allureBinAbs)) {
    return {
      ok: false,
      exitCode: null,
      durationMs: 0,
      stdout: "",
      stderr: "",
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

  const startedAt = Date.now();
  const handle = runner.run(
    {
      executable: allureBinAbs,
      args: ["generate", resultsDirRel, "-o", reportDirRel, "--clean"],
      cwd: projectRoot,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      label: "allure-generate"
    },
    {
      // We capture stdout/stderr via the result, not via streaming
      // handlers — the volume is small and we surface the verbatim
      // bytes for diagnostic display.
    }
  );

  let result;
  try {
    result = await handle.result;
  } catch (error) {
    // Spawn / policy errors (e.g. CommandPolicyError when args validation
    // fails). Return as a structured outcome rather than re-throwing so
    // the caller (RunManager) can attach a warning to metadata.warnings
    // without aborting the post-run pipeline.
    const code =
      error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"
        ? (error as { code: string }).code
        : error instanceof Error
          ? error.name
          : "UNKNOWN";
    return {
      ok: false,
      exitCode: null,
      durationMs: Date.now() - startedAt,
      stdout: "",
      stderr: "",
      warnings: [
        `Allure HTML report generation failed before exit. code=${code}`
      ]
    };
  }

  const durationMs = result.durationMs;
  const ok = result.exitCode === 0;
  const warnings: string[] = [];
  if (!ok) {
    if (result.timedOut) {
      warnings.push(
        `Allure HTML report generation timed out after ${input.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms.`
      );
    } else {
      warnings.push(
        `Allure HTML report generation failed. exitCode=${result.exitCode ?? "null"}; signal=${result.signal ?? "null"}`
      );
    }
  }

  return {
    ok,
    exitCode: result.exitCode,
    durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    reportPath: ok ? allureReportDir : undefined,
    warnings
  };
}
