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

export interface RunManagerLogger {
  error(payload: Record<string, unknown>, message: string): void;
  warn?(payload: Record<string, unknown>, message: string): void;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "UNKNOWN";
}

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
  runnerForProject: (projectRoot: string) => CommandRunner;
  bus: EventBus;
  /** Optional injection points (defaults wired for production). */
  artifactsStore?: RunArtifactsStore;
  reportProvider?: ReportProvider;
  logger?: RunManagerLogger;
}

function newRunId(): string {
  return `run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

type JsonReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "missing" | "invalid-json" | "read-error"; code: string };

// 欠落と破損を分けることで、通常の skip と調査対象の failure をログで区別する。
async function readJsonFile<T>(filePath: string): Promise<JsonReadResult<T>> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    const code = errorCode(error);
    return { ok: false, reason: code === "ENOENT" ? "missing" : "read-error", code };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false, reason: "invalid-json", code: "INVALID_JSON" };
  }
}

interface LogWriteTracker {
  write(stream: "stdout" | "stderr", chunk: string): void;
  flush(): Promise<string[]>;
}

// stream ごとに queue を分け、stdout の遅延や失敗が stderr の配送順を歪めないようにする。
function createLogWriteTracker({
  logStreams,
  logger,
  runId
}: {
  logStreams: Awaited<ReturnType<RunArtifactsStore["openLogStreams"]>>;
  logger?: RunManagerLogger;
  runId: string;
}): LogWriteTracker {
  const failures: Record<"stdout" | "stderr", { count: number; firstCode: string; codes: Set<string> }> = {
    stdout: { count: 0, firstCode: "UNKNOWN", codes: new Set() },
    stderr: { count: 0, firstCode: "UNKNOWN", codes: new Set() }
  };
  const logged = { stdout: false, stderr: false };
  const queues: Record<"stdout" | "stderr", Promise<void>> = {
    stdout: Promise.resolve(),
    stderr: Promise.resolve()
  };

  function recordFailure(stream: "stdout" | "stderr", error: unknown): void {
    const code = errorCode(error);
    const current = failures[stream];
    failures[stream] = {
      count: current.count + 1,
      firstCode: current.count === 0 ? code : current.firstCode,
      codes: new Set([...current.codes, code])
    };
    if (!logged[stream]) {
      logged[stream] = true;
      // 構造化ログは stream ごとの最初の原因に揃え、後続の code 差分は warning の codes に集約する。
      logger?.error(
        {
          runId,
          stream,
          artifactKind: "log",
          code,
          err: error instanceof Error ? error.message : String(error)
        },
        "run log write failed"
      );
    }
  }

  return {
    write(stream, chunk) {
      const target = stream === "stdout" ? logStreams.stdout : logStreams.stderr;
      queues[stream] = queues[stream]
        .then(() => target.write(chunk))
        .then(
          () => undefined,
          (error) => {
            recordFailure(stream, error);
          }
        );
    },
    async flush() {
      await Promise.all([queues.stdout, queues.stderr]);
      return (["stdout", "stderr"] as const).flatMap((stream) => {
        const failure = failures[stream];
        if (failure.count === 0) return [];
        const codes = Array.from(failure.codes).join(",");
        return [
          `${stream} log write failed; websocket stream was still delivered. code=${failure.firstCode}; codes=${codes}; failures=${failure.count}`
        ];
      });
    }
  };
}

export function createRunManager({
  runnerForProject,
  bus,
  artifactsStore = defaultArtifactsStore,
  reportProvider = playwrightJsonReportProvider,
  logger
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
    const logWriter = createLogWriteTracker({ logStreams, logger, runId });

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

      const runner = runnerForProject(params.projectRoot);
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
            logWriter.write("stdout", safe);
            bus.publish({ type: "run.stdout", runId, payload: { chunk: safe } });
          },
          onStderr: (chunk) => {
            const safe = redact(chunk);
            logWriter.write("stderr", safe);
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
          `Runner rejected the command before spawn. code=${errorCode(error)}`
        ]
      };
      await artifactsStore.writeMetadata(paths.metadataJson, failed);
      bus.publish({
        type: "run.error",
        runId,
        payload: {
          message: "Runner rejected the command before spawn.",
          exitCode: null,
          signal: null,
          status: "error",
          durationMs: failed.durationMs ?? 0,
          warnings: failed.warnings
        }
      });
      throw error;
    }

    const finished: Promise<RunMetadata> = (async () => {
      try {
        const result = await handle.result;
        const logWriteWarnings = await logWriter.flush();
        await logStreams.closeAll();

        const redactionWarning = await redactPlaywrightResultsSafely({
          artifactsStore,
          logger,
          runId,
          playwrightJsonPath: paths.playwrightJson
        });
        // summary は metadata と WS に流れるため、必ず scrubbed JSON から読む。
        const summary = await readSummarySafely(
          reportProvider,
          {
            projectRoot: params.projectRoot,
            runDir: paths.runDir,
            playwrightJsonPath: paths.playwrightJson
          },
          { logger, runId }
        );
        const warnings = [
          ...runningMetadata.warnings,
          ...logWriteWarnings,
          ...(summary?.warnings ?? [])
        ];
        if (redactionWarning) warnings.push(redactionWarning);

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

        // terminal event ごとに payload shape が異なるため、summary/message の混在をここで防ぐ。
        const terminalPayload =
          outcome.status === "cancelled"
            ? {
                exitCode: outcome.exitCode,
                signal: outcome.signal,
                status: "cancelled" as const,
                durationMs: outcome.durationMs,
                warnings
              }
            : outcome.status === "error"
              ? {
                  message: "Run completed with error status.",
                  exitCode: outcome.exitCode,
                  signal: outcome.signal,
                  status: "error" as const,
                  durationMs: outcome.durationMs,
                  warnings
                }
              : {
                  exitCode: outcome.exitCode,
                  signal: outcome.signal,
                  status: outcome.status,
                  durationMs: outcome.durationMs,
                  summary: summary?.summary,
                  warnings
                };
        try {
          bus.publish({
            type:
              outcome.status === "cancelled"
                ? "run.cancelled"
                : outcome.status === "error"
                  ? "run.error"
                  : "run.completed",
            runId,
            payload: terminalPayload
          });
        } catch (error) {
          logger?.error(
            { runId, err: error instanceof Error ? error.message : String(error) },
            "terminal event publish failed"
          );
        } finally {
          active.delete(runId);
        }
        return completed;
      } catch (error) {
        const logWriteWarnings = await logWriter.flush();
        await logStreams.closeAll();
        const completedAt = new Date();
        const completed: RunMetadata = {
          ...runningMetadata,
          status: "error",
          completedAt: completedAt.toISOString(),
          durationMs: completedAt.getTime() - startedAt.getTime(),
          warnings: [
            ...runningMetadata.warnings,
            ...logWriteWarnings,
            `Runner failed after spawn. code=${errorCode(error)}`
          ]
        };
        await artifactsStore.writeMetadata(paths.metadataJson, completed);
        try {
          bus.publish({
            type: "run.error",
            runId,
            payload: {
              message: "Runner failed after spawn.",
              exitCode: null,
              signal: null,
              status: "error",
              durationMs: completed.durationMs ?? 0,
              warnings: completed.warnings
            }
          });
        } catch (publishError) {
          logger?.error(
            { runId, err: publishError instanceof Error ? publishError.message : String(publishError) },
            "terminal event publish failed"
          );
        } finally {
          active.delete(runId);
        }
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

async function redactPlaywrightResultsSafely({
  artifactsStore,
  logger,
  runId,
  playwrightJsonPath
}: {
  artifactsStore: RunArtifactsStore;
  logger?: RunManagerLogger;
  runId: string;
  playwrightJsonPath: string;
}): Promise<string | undefined> {
  // raw reporter output は secret を含み得る。成功なら無警告、redaction 失敗でも削除できたら
  // "removed" warning、削除も失敗したら secret 残存可能性を明示する warning に分ける。
  try {
    await artifactsStore.redactPlaywrightResults(playwrightJsonPath);
    return undefined;
  } catch (error) {
    const redactionCode = errorCode(error);
    logger?.error(
      {
        runId,
        err: error instanceof Error ? error.message : String(error),
        code: redactionCode,
        playwrightJsonPath
      },
      "playwright-results redaction failed"
    );
    try {
      await fs.unlink(playwrightJsonPath);
      return `Playwright JSON redaction failed; removed raw result artifact. redactionCode=${redactionCode}`;
    } catch (unlinkError) {
      const unlinkCode = errorCode(unlinkError);
      logger?.error(
        {
          runId,
          err: unlinkError instanceof Error ? unlinkError.message : String(unlinkError),
          code: unlinkCode,
          playwrightJsonPath
        },
        "failed to remove raw playwright-results artifact after redaction failure"
      );
      return `Playwright JSON redaction failed; raw result artifact may still contain secrets. redactionCode=${redactionCode}; removalCode=${unlinkCode}`;
    }
  }
}

async function readSummarySafely(
  provider: ReportProvider,
  input: { projectRoot: string; runDir: string; playwrightJsonPath: string },
  context: { logger?: RunManagerLogger; runId: string }
): Promise<{ summary?: TestResultSummary; warnings: string[] } | undefined> {
  try {
    const result = await provider.readSummary(input);
    return result;
  } catch (error) {
    const code = errorCode(error);
    context.logger?.error(
      {
        runId: context.runId,
        provider: provider.name,
        artifactKind: "playwright-json-summary",
        code,
        err: error instanceof Error ? error.message : String(error)
      },
      "report summary read failed"
    );
    return {
      warnings: [`${provider.name} report read failed; summary unavailable. code=${code}`]
    };
  }
}

/**
 * Reads run metadata from disk for a given project. Used to populate the run
 * list across server restarts and for runs that are no longer active.
 */
export async function loadRunsFromDisk(
  projectRoot: string,
  logger?: RunManagerLogger
): Promise<RunMetadata[]> {
  const wb = workbenchPaths(projectRoot);
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(wb.runsDir, { withFileTypes: true });
  } catch (error) {
    const code = errorCode(error);
    if (code !== "ENOENT") {
      logger?.warn?.(
        {
          artifactKind: "runs-directory",
          code
        },
        "run directory could not be listed"
      );
    }
    return [];
  }
  const runs: RunMetadata[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metadataPath = path.join(wb.runsDir, entry.name, "metadata.json");
    let stat;
    try {
      stat = await fs.lstat(metadataPath);
    } catch (error) {
      const code = errorCode(error);
      if (code !== "ENOENT") {
        logger?.warn?.(
          {
            runDir: entry.name,
            artifactKind: "metadata",
            reason: "stat-error",
            code
          },
          "run metadata could not be inspected"
        );
      }
      continue;
    }
    if (!stat.isFile()) {
      logger?.warn?.(
        {
          runDir: entry.name,
          artifactKind: "metadata",
          reason: "not-file"
        },
        "run metadata is not a regular file"
      );
      continue;
    }
    const metadata = await readJsonFile<RunMetadata>(metadataPath);
    if (metadata.ok) {
      runs.push(metadata.value);
      continue;
    }
    if (metadata.reason !== "missing") {
      logger?.warn?.(
        {
          runDir: entry.name,
          artifactKind: "metadata",
          reason: metadata.reason,
          code: metadata.code
        },
        "run metadata could not be loaded"
      );
    }
  }
  return runs.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/**
 * Returns the freshest view of every run for a project: in-memory active runs
 * override disk metadata when the same runId appears in both.
 */
export async function mergeActiveAndPersistedRuns(
  manager: RunManager,
  projectRoot: string,
  logger?: RunManagerLogger
): Promise<RunMetadata[]> {
  const fromDisk = await loadRunsFromDisk(projectRoot, logger);
  const fromMemory = await manager.listRuns();
  const byId = new Map<string, RunMetadata>();
  for (const run of fromDisk) byId.set(run.runId, run);
  for (const run of fromMemory) byId.set(run.runId, run); // in-memory wins
  return Array.from(byId.values()).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}
