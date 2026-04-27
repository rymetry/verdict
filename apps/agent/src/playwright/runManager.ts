import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type DetectedPackageManager,
  type RunMetadata,
  type RunRequest,
  type RunStatus,
  type TestResultSummary
} from "@pwqa/shared";
import type { CommandRunner } from "../commands/runner.js";
import { redact } from "../commands/redact.js";
import type { EventBus } from "../events/bus.js";
import { runPathsFor, workbenchPaths } from "../storage/paths.js";
import { buildPlaywrightTestCommand } from "./builder.js";
import { summarizePlaywrightJson } from "./jsonReport.js";

export interface RunStartParams {
  projectId: string;
  projectRoot: string;
  packageManager: DetectedPackageManager;
  request: RunRequest;
}

export interface ActiveRunHandle {
  runId: string;
  cancel(reason?: string): void;
  metadata: RunMetadata;
  finished: Promise<RunMetadata>;
}

export interface RunRecord {
  metadata: RunMetadata;
}

export interface RunManager {
  startRun(params: RunStartParams): Promise<ActiveRunHandle>;
  getRun(runId: string): Promise<RunMetadata | undefined>;
  listRuns(projectId?: string): Promise<RunMetadata[]>;
  cancelRun(runId: string): boolean;
}

interface RunManagerDeps {
  runner: CommandRunner;
  bus: EventBus;
}

function ensureDirSync(p: string): void {
  fsSync.mkdirSync(p, { recursive: true });
}

async function safeReadJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function createRunManager({ runner, bus }: RunManagerDeps): RunManager {
  const active = new Map<string, ActiveRunHandle>();

  async function startRun(params: RunStartParams): Promise<ActiveRunHandle> {
    if (params.packageManager.blockingExecution) {
      throw new Error(
        `Run blocked: ${params.packageManager.errors.join(" ") || "package manager status prevents execution."}`
      );
    }

    const runId = `run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const paths = runPathsFor(params.projectRoot, runId);
    ensureDirSync(paths.runDir);
    ensureDirSync(paths.playwrightHtml);

    // §18: ensure top-level workbench dirs exist
    const wb = workbenchPaths(params.projectRoot);
    ensureDirSync(wb.runsDir);
    ensureDirSync(wb.reportsDir);
    ensureDirSync(wb.configDir);

    const { command, env } = buildPlaywrightTestCommand({
      packageManager: params.packageManager,
      request: params.request,
      jsonOutputPath: paths.playwrightJson,
      htmlOutputDir: paths.playwrightHtml,
      projectRoot: params.projectRoot
    });

    const startedAt = new Date();
    const metadata: RunMetadata = {
      runId,
      projectId: params.projectId,
      projectRoot: params.projectRoot,
      status: "queued",
      startedAt: startedAt.toISOString(),
      command,
      cwd: params.projectRoot,
      requested: params.request,
      paths,
      warnings: [...params.packageManager.warnings],
      exitCode: null,
      signal: null
    };

    await fs.writeFile(paths.metadataJson, JSON.stringify(metadata, null, 2), "utf8");
    bus.publish({ type: "run.queued", runId, payload: { request: params.request } });

    // Buffered file writers for stdout/stderr.
    const stdoutFile = await fs.open(paths.stdoutLog, "w");
    const stderrFile = await fs.open(paths.stderrLog, "w");

    bus.publish({
      type: "run.started",
      runId,
      payload: { command, cwd: params.projectRoot, startedAt: metadata.startedAt }
    });
    metadata.status = "running";
    await fs.writeFile(paths.metadataJson, JSON.stringify(metadata, null, 2), "utf8");

    const handle = runner.run(
      {
        executable: command.executable,
        args: command.args,
        cwd: params.projectRoot,
        env: { ...process.env, ...env },
        label: `run:${runId}`
      },
      {
        onStdout: (chunk) => {
          const safe = redact(chunk);
          stdoutFile.write(safe).catch(() => undefined);
          bus.publish({ type: "run.stdout", runId, payload: { chunk: safe } });
        },
        onStderr: (chunk) => {
          const safe = redact(chunk);
          stderrFile.write(safe).catch(() => undefined);
          bus.publish({ type: "run.stderr", runId, payload: { chunk: safe } });
        }
      }
    );

    const finished: Promise<RunMetadata> = (async () => {
      let summary: TestResultSummary | undefined;
      let status: RunStatus = "running";
      try {
        const result = await handle.result;
        await stdoutFile.close();
        await stderrFile.close();
        const playwrightJsonRaw = await fs.readFile(paths.playwrightJson, "utf8").catch(() => "");
        if (playwrightJsonRaw) {
          const summaryResult = summarizePlaywrightJson(params.projectRoot, playwrightJsonRaw);
          summary = summaryResult.summary;
          metadata.warnings.push(...summaryResult.warnings);
        }
        if (result.cancelled) {
          status = "cancelled";
        } else if (result.timedOut) {
          status = "error";
          metadata.warnings.push("Run timed out and was terminated.");
        } else if (result.exitCode === 0) {
          status = "passed";
        } else if (typeof result.exitCode === "number") {
          status = "failed";
        } else {
          status = "error";
        }
        const completedAt = new Date();
        const completed: RunMetadata = {
          ...metadata,
          status,
          exitCode: result.exitCode,
          signal: result.signal,
          durationMs: completedAt.getTime() - startedAt.getTime(),
          completedAt: completedAt.toISOString(),
          summary
        };
        await fs.writeFile(paths.metadataJson, JSON.stringify(completed, null, 2), "utf8");
        bus.publish({
          type:
            status === "cancelled"
              ? "run.cancelled"
              : status === "error"
                ? "run.error"
                : "run.completed",
          runId,
          payload: {
            exitCode: result.exitCode,
            signal: result.signal,
            status,
            durationMs: completed.durationMs ?? 0,
            summary
          }
        });
        active.delete(runId);
        return completed;
      } catch (error) {
        await stdoutFile.close();
        await stderrFile.close();
        const completedAt = new Date();
        const completed: RunMetadata = {
          ...metadata,
          status: "error",
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
          warnings: [
            ...metadata.warnings,
            `Runner failed: ${error instanceof Error ? error.message : String(error)}`
          ]
        };
        await fs.writeFile(paths.metadataJson, JSON.stringify(completed, null, 2), "utf8");
        bus.publish({
          type: "run.error",
          runId,
          payload: {
            message: error instanceof Error ? error.message : String(error)
          }
        });
        active.delete(runId);
        return completed;
      }
    })();

    const activeHandle: ActiveRunHandle = {
      runId,
      metadata,
      finished,
      cancel(reason?: string) {
        handle.cancel(reason);
      }
    };
    active.set(runId, activeHandle);
    return activeHandle;
  }

  async function getRun(runId: string): Promise<RunMetadata | undefined> {
    const activeHandle = active.get(runId);
    if (activeHandle) return activeHandle.metadata;
    // Fallback: load from disk by scanning known projects? For PoC, if not active, the caller
    // must provide projectRoot context via API. We expose `findRun` instead via listRuns.
    return undefined;
  }

  async function listRuns(): Promise<RunMetadata[]> {
    return Array.from(active.values()).map((handle) => handle.metadata);
  }

  function cancelRun(runId: string): boolean {
    const handle = active.get(runId);
    if (!handle) return false;
    handle.cancel("user-request");
    return true;
  }

  return { startRun, getRun, listRuns, cancelRun };
}

/**
 * Reads run metadata from disk for a given project. Used to populate the run
 * list across server restarts and for runs that are no longer active.
 */
export async function loadRunsFromDisk(projectRoot: string): Promise<RunMetadata[]> {
  const wb = workbenchPaths(projectRoot);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(wb.runsDir);
  } catch {
    return [];
  }
  const runs: RunMetadata[] = [];
  for (const entry of entries) {
    const metadataPath = path.join(wb.runsDir, entry, "metadata.json");
    const metadata = await safeReadJson<RunMetadata>(metadataPath);
    if (metadata) runs.push(metadata);
  }
  return runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}
