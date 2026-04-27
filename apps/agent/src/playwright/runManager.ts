import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type DetectedPackageManager,
  type RunMetadata,
  type RunRequest,
  type TestResultSummary
} from "@pwqa/shared";
import type { CommandRunner } from "../commands/runner.js";
import { redact } from "../commands/redact.js";
import type { EventBus } from "../events/bus.js";
import { runPathsFor, workbenchPaths } from "../storage/paths.js";
import { buildPlaywrightTestCommand } from "./builder.js";
import {
  runArtifactsStore as defaultArtifactsStore,
  type RunArtifactsStore
} from "./runArtifactsStore.js";
import { deriveOutcome } from "./runOutcome.js";
import { playwrightJsonReportProvider } from "../reporting/PlaywrightJsonReportProvider.js";
import type { ReportProvider } from "../reporting/ReportProvider.js";

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

export interface RunManager {
  startRun(params: RunStartParams): Promise<ActiveRunHandle>;
  listRuns(projectId?: string): Promise<RunMetadata[]>;
  cancelRun(runId: string): boolean;
}

interface RunManagerDeps {
  runner: CommandRunner;
  bus: EventBus;
  /** Optional injection points (defaults wired for production). */
  artifactsStore?: RunArtifactsStore;
  reportProvider?: ReportProvider;
}

function newRunId(): string {
  return `run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

async function safeReadJson<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function createRunManager({
  runner,
  bus,
  artifactsStore = defaultArtifactsStore,
  reportProvider = playwrightJsonReportProvider
}: RunManagerDeps): RunManager {
  const active = new Map<string, ActiveRunHandle>();

  async function startRun(params: RunStartParams): Promise<ActiveRunHandle> {
    if (params.packageManager.blockingExecution) {
      throw new Error(
        `Run blocked: ${
          params.packageManager.errors.join(" ") ||
          "package manager status prevents execution."
        }`
      );
    }

    const runId = newRunId();
    const paths = runPathsFor(params.projectRoot, runId);
    artifactsStore.ensureDirs(params.projectRoot, paths.runDir, paths.playwrightHtml);

    const { command, env } = buildPlaywrightTestCommand({
      packageManager: params.packageManager,
      request: params.request,
      jsonOutputPath: paths.playwrightJson,
      htmlOutputDir: paths.playwrightHtml,
      projectRoot: params.projectRoot
    });

    const startedAt = new Date();
    const initialMetadata: RunMetadata = {
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

    await artifactsStore.writeMetadata(paths.metadataJson, initialMetadata);
    bus.publish({ type: "run.queued", runId, payload: { request: params.request } });

    const logStreams = await artifactsStore.openLogStreams(paths.stdoutLog, paths.stderrLog);

    let runningMetadata: RunMetadata;
    let handle;
    try {
      runningMetadata = { ...initialMetadata, status: "running" };
      await artifactsStore.writeMetadata(paths.metadataJson, runningMetadata);
      bus.publish({
        type: "run.started",
        runId,
        payload: { command, cwd: params.projectRoot, startedAt: runningMetadata.startedAt }
      });

      handle = runner.run(
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
            logStreams.stdout.write(safe).catch(() => undefined);
            bus.publish({ type: "run.stdout", runId, payload: { chunk: safe } });
          },
          onStderr: (chunk) => {
            const safe = redact(chunk);
            logStreams.stderr.write(safe).catch(() => undefined);
            bus.publish({ type: "run.stderr", runId, payload: { chunk: safe } });
          }
        }
      );
    } catch (error) {
      // CommandPolicyError or similar synchronous throw before the child
      // exists. Close streams, persist an error metadata snapshot, propagate.
      await logStreams.closeAll();
      const failed: RunMetadata = {
        ...runningMetadata!,
        status: "error",
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        warnings: [
          ...initialMetadata.warnings,
          `Runner rejected the command: ${error instanceof Error ? error.message : String(error)}`
        ]
      };
      await artifactsStore.writeMetadata(paths.metadataJson, failed);
      bus.publish({
        type: "run.error",
        runId,
        payload: { message: error instanceof Error ? error.message : String(error) }
      });
      throw error;
    }

    const finished: Promise<RunMetadata> = (async () => {
      try {
        const result = await handle.result;
        await logStreams.closeAll();

        // §28 / security review #8: scrub the Playwright JSON before either
        // the report provider reads it or the API surfaces its path.
        await artifactsStore
          .redactPlaywrightResults(paths.playwrightJson)
          .catch(() => undefined);

        const summary = await readSummarySafely(reportProvider, {
          projectRoot: params.projectRoot,
          runDir: paths.runDir,
          playwrightJsonPath: paths.playwrightJson
        });
        const warnings = [...runningMetadata.warnings, ...(summary?.warnings ?? [])];

        const outcome = deriveOutcome(result, startedAt);
        if (outcome.warning) warnings.push(outcome.warning);

        const completed: RunMetadata = {
          ...runningMetadata,
          status: outcome.status,
          exitCode: outcome.exitCode,
          signal: outcome.signal,
          durationMs: outcome.durationMs,
          completedAt: new Date().toISOString(),
          summary: summary?.summary,
          warnings
        };
        await artifactsStore.writeMetadata(paths.metadataJson, completed);

        bus.publish({
          type:
            outcome.status === "cancelled"
              ? "run.cancelled"
              : outcome.status === "error"
                ? "run.error"
                : "run.completed",
          runId,
          payload: {
            exitCode: outcome.exitCode,
            signal: outcome.signal,
            status: outcome.status,
            durationMs: outcome.durationMs,
            summary: summary?.summary
          }
        });
        active.delete(runId);
        return completed;
      } catch (error) {
        await logStreams.closeAll();
        const completedAt = new Date();
        const completed: RunMetadata = {
          ...runningMetadata,
          status: "error",
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
          warnings: [
            ...runningMetadata.warnings,
            `Runner failed: ${error instanceof Error ? error.message : String(error)}`
          ]
        };
        await artifactsStore.writeMetadata(paths.metadataJson, completed);
        bus.publish({
          type: "run.error",
          runId,
          payload: { message: error instanceof Error ? error.message : String(error) }
        });
        active.delete(runId);
        return completed;
      }
    })();

    const activeHandle: ActiveRunHandle = {
      runId,
      metadata: runningMetadata,
      finished,
      cancel(reason?: string) {
        handle.cancel(reason);
      }
    };
    active.set(runId, activeHandle);
    return activeHandle;
  }

  async function listRuns(): Promise<RunMetadata[]> {
    return Array.from(active.values()).map((value) => value.metadata);
  }

  function cancelRun(runId: string): boolean {
    const value = active.get(runId);
    if (!value) return false;
    value.cancel("user-request");
    return true;
  }

  return { startRun, listRuns, cancelRun };
}

async function readSummarySafely(
  provider: ReportProvider,
  input: { projectRoot: string; runDir: string; playwrightJsonPath: string }
): Promise<{ summary?: TestResultSummary; warnings: string[] } | undefined> {
  try {
    const result = await provider.readSummary(input);
    return result;
  } catch (error) {
    return {
      warnings: [
        `${provider.name} report read failed: ${error instanceof Error ? error.message : String(error)}`
      ]
    };
  }
}

/**
 * Reads run metadata from disk for a given project. Used to populate the run
 * list across server restarts and for runs that are no longer active.
 */
export async function loadRunsFromDisk(projectRoot: string): Promise<RunMetadata[]> {
  const wb = workbenchPaths(projectRoot);
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(wb.runsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const runs: RunMetadata[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metadataPath = path.join(wb.runsDir, entry.name, "metadata.json");
    const stat = await fs.lstat(metadataPath).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    const metadata = await safeReadJson<RunMetadata>(metadataPath);
    if (metadata) runs.push(metadata);
  }
  return runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/**
 * Returns the freshest view of every run for a project: in-memory active runs
 * override disk metadata when the same runId appears in both.
 */
export async function mergeActiveAndPersistedRuns(
  manager: RunManager,
  projectRoot: string
): Promise<RunMetadata[]> {
  const fromDisk = await loadRunsFromDisk(projectRoot);
  const fromMemory = await manager.listRuns();
  const byId = new Map<string, RunMetadata>();
  for (const run of fromDisk) byId.set(run.runId, run);
  for (const run of fromMemory) byId.set(run.runId, run); // in-memory wins
  return Array.from(byId.values()).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}
