import * as path from "node:path";
import type { RunPaths } from "@pwqa/shared";

export const WORKBENCH_DIR_NAME = ".playwright-workbench";

export interface WorkbenchPaths {
  root: string;
  workbenchDir: string;
  configDir: string;
  reportsDir: string;
  runsDir: string;
  /**
   * Project-scoped archive root (Phase 1.2 / T203-2). The archive lifecycle
   * (PLAN.v2 §22) moves the user's pre-existing `allure-results/*` here
   * before each run so that user artifacts are preserved instead of
   * overwritten. Each archive operation creates a timestamped subdirectory
   * (`<archiveDir>/<ISO-timestamp>/`) so multiple runs do not collide.
   */
  archiveDir: string;
  /**
   * Project-scoped Allure history file (Phase 1.2 / T206). Populated by
   * the Allure CLI on each `generate` invocation when `--history-path`
   * is passed. JSONL format per the T200 investigation. Cross-run
   * trend signal (flaky candidates, regression detection) is later
   * derived from this file by T207 QMO summary.
   */
  allureHistoryPath: string;
}

export function workbenchPaths(projectRoot: string): WorkbenchPaths {
  const workbenchDir = path.join(projectRoot, WORKBENCH_DIR_NAME);
  const reportsDir = path.join(workbenchDir, "reports");
  return {
    root: projectRoot,
    workbenchDir,
    configDir: path.join(workbenchDir, "config"),
    reportsDir,
    runsDir: path.join(workbenchDir, "runs"),
    archiveDir: path.join(workbenchDir, "archive"),
    allureHistoryPath: path.join(reportsDir, "allure-history.jsonl")
  };
}

export function runPathsFor(projectRoot: string, runId: string): RunPaths {
  const { runsDir } = workbenchPaths(projectRoot);
  const runDir = path.join(runsDir, runId);
  return {
    runDir,
    metadataJson: path.join(runDir, "metadata.json"),
    stdoutLog: path.join(runDir, "stdout.log"),
    stderrLog: path.join(runDir, "stderr.log"),
    playwrightJson: path.join(runDir, "playwright-results.json"),
    playwrightHtml: path.join(runDir, "playwright-report"),
    artifactsJson: path.join(runDir, "artifacts.json"),
    // Phase 1.2 (T203-2): destination for the post-run copy of the user's
    // `allure-results/*`. Always derivable per-run, even when the project
    // does not use Allure — the path is structurally consistent and only
    // populated when `RunArtifactsStore.copyAllureResultsDir` is called.
    allureResultsDest: path.join(runDir, "allure-results"),
    // Phase 1.2 (T204-1): destination for the Allure CLI HTML report
    // (`allure generate -o <here>`). Same convention as `allureResultsDest`:
    // structurally derived per-run, only populated when T204-2 wires the
    // CLI subprocess. UI/API later renders this as a `file://` link or
    // serves it via `allure open` / static hosting.
    allureReportDir: path.join(runDir, "allure-report"),
    // Phase 1.2 (T205-2): persisted Quality Gate result JSON. Conforms
    // to `QualityGateResultSchema` in `@pwqa/shared` and is written by
    // RunManager's quality-gate lifecycle hook after the report
    // generation step. UI/API surfaces the file as the source of truth
    // for QMO release-readiness checks.
    qualityGateResultPath: path.join(runDir, "quality-gate-result.json")
  };
}
