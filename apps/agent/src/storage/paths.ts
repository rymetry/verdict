import * as path from "node:path";
import type { RunPaths } from "@pwqa/shared";

export const WORKBENCH_DIR_NAME = ".playwright-workbench";

export interface WorkbenchPaths {
  root: string;
  workbenchDir: string;
  configDir: string;
  reportsDir: string;
  runsDir: string;
}

export function workbenchPaths(projectRoot: string): WorkbenchPaths {
  const workbenchDir = path.join(projectRoot, WORKBENCH_DIR_NAME);
  return {
    root: projectRoot,
    workbenchDir,
    configDir: path.join(workbenchDir, "config"),
    reportsDir: path.join(workbenchDir, "reports"),
    runsDir: path.join(workbenchDir, "runs")
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
    artifactsJson: path.join(runDir, "artifacts.json")
  };
}
