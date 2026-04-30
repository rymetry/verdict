import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type DetectedPackageManager,
  type RunCancellationReason,
  type RunMetadata,
  type RunRequest,
  type TestResultSummary,
  type TerminalEventType,
  type WorkbenchEventInput
} from "@pwqa/shared";
import type { CommandRunner } from "../commands/runner.js";
import { redactWithStats, type RedactionResult } from "../commands/redact.js";
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
import {
  type ArtifactKind,
  type ArtifactOperation,
  errorCode,
  errorLogFields
} from "../lib/structuredLog.js";
import type { RunManagerLogger } from "./runTypes.js";
import { createStreamRedactor } from "./streamRedactor.js";

export type { RunManagerLogger } from "./runTypes.js";

export interface RunStartParams {
  projectId: string;
  projectRoot: string;
  packageManager: DetectedPackageManager;
  request: RunRequest;
  /**
   * Phase 1.2 (T203-3): the project-relative `resultsDir` extracted by
   * ProjectScanner from the `allure-playwright` reporter clause in
   * `playwright.config.{ts,js,mjs,cjs}` (T203-1). When defined, RunManager
   * archives existing entries of the source dir before the run (PLAN.v2
   * §22 detect/archive/copy) and copies post-run output into
   * `<runDir>/allure-results/`. When undefined (no Allure reporter,
   * dynamic config, or the value failed validation), the lifecycle is a
   * no-op — the rest of the run flow is unaffected.
   */
  allureResultsDir?: string;
}

export interface ActiveRunHandle {
  runId: string;
  cancel(reason?: RunCancellationReason): void;
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
  redactor?: (chunk: string) => RedactionResult;
  logger?: RunManagerLogger;
  /**
   * Phase 1.2 (T204-3): CommandRunner factory scoped to the Allure CLI
   * (built with `createAllureCommandPolicy`). When provided, RunManager
   * invokes `allure generate` after the run-scoped allure-results copy
   * lands. Undefined → HTML generation skipped (test envs, projects
   * without Allure CLI installed).
   */
  allureRunnerForProject?: (projectRoot: string) => CommandRunner;
}

/**
 * Operational error codes that abort the QG persistence path instead of
 * being swallowed into a structured warning. Matches the FATAL_OPERATIONAL_CODES
 * set in `runArtifactsStore.ts` (T203-2) and `allureReportGenerator.ts`
 * (T204-3) — write-side fatals only since persistence mutates the
 * filesystem. PR #45 T205-2 review found that demoting these codes
 * silently lost the QualityGateResult source-of-truth.
 */
const PERSIST_FATAL_CODES = new Set([
  "EMFILE",
  "ENFILE",
  "EACCES",
  "EIO",
  "ENOSPC",
  "EDQUOT",
  "EROFS"
]);

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
  const loggedCodes: Record<"stdout" | "stderr", Set<string>> = {
    stdout: new Set(),
    stderr: new Set()
  };
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
    if (!loggedCodes[stream].has(code)) {
      loggedCodes[stream].add(code);
      // 同一 code の連続失敗は集約し、異なる code は構造化ログにも残して調査可能にする。
      const artifactKind: ArtifactKind = stream === "stdout" ? "stdout-log" : "stderr-log";
      logger?.error(
        {
          runId,
          stream,
          artifactKind,
          ...errorLogFields(error)
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

type PublishInput = WorkbenchEventInput;
type TerminalPublishInput = Extract<PublishInput, { type: TerminalEventType }>;

type PublishResult =
  | { ok: true }
  | { ok: false; error: unknown; code: string };

/**
 * Publishes a run event without letting producer-side schema checks or adapter
 * failures escape runner callbacks. The caller decides whether a failed publish
 * needs a user-visible terminal warning.
 */
function publishEventSafely({
  bus,
  logger,
  event,
  message
}: {
  bus: EventBus;
  logger?: RunManagerLogger;
  event: PublishInput;
  message: string;
}): PublishResult {
  try {
    bus.publish(event);
    return { ok: true };
  } catch (error) {
    const code = errorCode(error);
    // Bus publish failures originate from the Zod validation gate in
    // `events/bus.ts` (`PayloadValidationError`). Their messages are
    // deterministic Zod issue lists ("Invalid run.completed payload: ...") with
    // no filesystem path content, so opt in to `keepMessage: true` to preserve
    // diagnostic detail without violating the path-redaction policy.
    logger?.error(
      {
        runId: "runId" in event ? event.runId : undefined,
        eventType: event.type,
        ...errorLogFields(error, { keepMessage: true })
      },
      message
    );
    return { ok: false, error, code };
  }
}

/**
 * Terminal events are the UI's primary completion signal. If the original
 * terminal payload is rejected, send a sanitized run.error fallback once; if
 * that also fails, emit a process warning as the last local observability path.
 */
function publishTerminalEventSafely({
  bus,
  logger,
  event,
  fallbackWarnings,
  isFallback = false
}: {
  bus: EventBus;
  logger?: RunManagerLogger;
  event: TerminalPublishInput;
  fallbackWarnings: string[];
  isFallback?: boolean;
}): void {
  const result = publishEventSafely({
    bus,
    logger,
    event,
    message: isFallback ? "terminal fallback event publish failed" : "terminal event publish failed"
  });
  if (result.ok) return;
  if (isFallback) {
    logger?.error(
      {
        runId: event.runId,
        originalEvent: event.type,
        originalStatus: event.payload.status,
        code: result.code
      },
      "terminal fallback publish exhausted; UI may remain running"
    );
    process.emitWarning("Terminal fallback event publish failed", {
      code: "PWQA_TERMINAL_FALLBACK_PUBLISH_FAILED"
    });
    return;
  }

  const payload = event.payload;
  publishTerminalEventSafely({
    bus,
    logger,
    event: {
      type: "run.error",
      runId: event.runId,
      payload: {
        message: "Terminal event could not be delivered.",
        exitCode: payload.exitCode,
        signal: payload.signal ?? null,
        status: "error",
        durationMs: payload.durationMs,
        warnings: [
          ...fallbackWarnings,
          `Terminal event could not be delivered. code=${result.code}; originalEvent=${event.type}; originalStatus=${payload.status}`
        ]
      }
    },
    fallbackWarnings,
    isFallback: true
  });
}


export function createRunManager({
  runnerForProject,
  bus,
  artifactsStore = defaultArtifactsStore,
  reportProvider = playwrightJsonReportProvider,
  redactor = redactWithStats,
  logger,
  allureRunnerForProject
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

    // Phase 1.2 archive step (T203-3): protect any user-side artifacts in
    // `allure-results/*` from the previous run by moving them aside before
    // launching Playwright. Failure is FATAL because re-running without
    // archive would silently overwrite user data — that violates the
    // PLAN.v2 §22 invariant that user artifacts are preserved across runs.
    const archiveWarnings = await runArchiveStep({
      projectRoot: params.projectRoot,
      allureResultsDir: params.allureResultsDir,
      runId,
      artifactsStore,
      logger
    });

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
      warnings: [...params.packageManager.warnings, ...archiveWarnings],
      exitCode: null,
      signal: null
    };

    await artifactsStore.writeMetadata(paths.metadataJson, initialMetadata);
    publishEventSafely({
      bus,
      logger,
      event: { type: "run.queued", runId, payload: { request: params.request } },
      message: "run queued event publish failed"
    });

    const logStreams = await artifactsStore.openLogStreams(paths.stdoutLog, paths.stderrLog);
    const logWriter = createLogWriteTracker({ logStreams, logger, runId });
    const streamRedactor = createStreamRedactor({ redactor, logger, runId });
    const streamPublishFailures: Record<"stdout" | "stderr", { count: number; firstCode: string; codes: Set<string> }> = {
      stdout: { count: 0, firstCode: "UNKNOWN", codes: new Set() },
      stderr: { count: 0, firstCode: "UNKNOWN", codes: new Set() }
    };
    const recordStreamPublishFailure = (stream: "stdout" | "stderr", result: PublishResult): void => {
      if (result.ok) return;
      const current = streamPublishFailures[stream];
      const isFirstFailure = current.count === 0;
      streamPublishFailures[stream].count += 1;
      streamPublishFailures[stream].firstCode = isFirstFailure ? result.code : current.firstCode;
      streamPublishFailures[stream].codes.add(result.code);
    };
    const flushStreamPublishWarnings = (): string[] =>
      (["stdout", "stderr"] as const).flatMap((stream) => {
        const failure = streamPublishFailures[stream];
        if (failure.count === 0) return [];
        const codes = Array.from(failure.codes).join(",");
        return [
          `${stream} websocket delivery failed; persisted log may contain additional output. code=${failure.firstCode}; codes=${codes}; failures=${failure.count}`
        ];
      });

    let runningMetadata: RunMetadata;
    let handle;
    try {
      runningMetadata = { ...initialMetadata, status: "running" };
      await artifactsStore.writeMetadata(paths.metadataJson, runningMetadata);
      publishEventSafely({
        bus,
        logger,
        event: {
          type: "run.started",
          runId,
          payload: { command, cwd: params.projectRoot, startedAt: runningMetadata.startedAt }
        },
        message: "run started event publish failed"
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
            const safe = streamRedactor.redact("stdout", chunk);
            logWriter.write("stdout", safe);
            const result = publishEventSafely({
              bus,
              logger,
              event: { type: "run.stdout", runId, payload: { chunk: safe } },
              message: "run stdout event publish failed"
            });
            recordStreamPublishFailure("stdout", result);
          },
          onStderr: (chunk) => {
            const safe = streamRedactor.redact("stderr", chunk);
            logWriter.write("stderr", safe);
            const result = publishEventSafely({
              bus,
              logger,
              event: { type: "run.stderr", runId, payload: { chunk: safe } },
              message: "run stderr event publish failed"
            });
            recordStreamPublishFailure("stderr", result);
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
      publishTerminalEventSafely({
        bus,
        logger,
        event: {
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
        },
        fallbackWarnings: failed.warnings
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
        // Phase 1.2 copy step (T203-3): materialize the user's post-run
        // `allure-results/*` into `<runDir>/allure-results/` so that
        // AllureReportProvider can read the run-scoped snapshot regardless
        // of what the user does to the source dir afterward. Failures here
        // are NON-fatal — Playwright already finished, so we surface a
        // structured-log error + a warning rather than aborting the run.
        const copyWarnings = await runCopyStep({
          projectRoot: params.projectRoot,
          allureResultsDir: params.allureResultsDir,
          allureResultsDest: paths.allureResultsDest,
          runId,
          artifactsStore,
          logger
        });
        // Phase 1.2 report-generation step (T204-3): invoke
        // `allure generate` against the run-scoped results directory to
        // produce the HTML report. Skipped when allureRunnerForProject is
        // unset (test envs / no CLI installed) or when the project does
        // not use Allure. Failure is NON-fatal — same rationale as copy.
        const allureRunner = allureRunnerForProject?.(params.projectRoot);
        const reportGenerationWarnings = await runReportGenerationStep({
          projectRoot: params.projectRoot,
          allureResultsDir: params.allureResultsDir,
          allureResultsDest: paths.allureResultsDest,
          allureReportDir: paths.allureReportDir,
          // T206: project-scoped history JSONL — Allure CLI accumulates
          // cross-run trend data here on each generate invocation.
          historyPath: workbenchPaths(params.projectRoot).allureHistoryPath,
          runId,
          allureRunner,
          logger
        });
        // Phase 1.2 quality-gate step (T205-2): evaluate Allure quality
        // gate against the run-scoped results dir. Persists the result
        // to `<runDir>/quality-gate-result.json` per PLAN.v2 §23. Same
        // skip conditions and non-fatal semantics as the report
        // generation step.
        const qualityGateWarnings = await runQualityGateStep({
          projectRoot: params.projectRoot,
          allureResultsDir: params.allureResultsDir,
          allureResultsDest: paths.allureResultsDest,
          qualityGateResultPath: paths.qualityGateResultPath,
          profile: params.request.qualityGateProfile ?? "local-review",
          runId,
          allureRunner,
          logger
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
          ...copyWarnings,
          ...reportGenerationWarnings,
          ...qualityGateWarnings,
          ...streamRedactor.flush(),
          ...flushStreamPublishWarnings(),
          ...(summary?.warnings ?? [])
        ];
        if (redactionWarning) warnings.push(redactionWarning);

        const outcome = deriveOutcome(result, startedAt);
        if (outcome.status === "error" && outcome.warning) warnings.push(outcome.warning);
        // Race window: a timeout that fires concurrently with user cancellation
        // produces both flags. `deriveOutcome` prefers the cancellation status,
        // so surface the timeout via a warning to preserve the diagnostic trail.
        if (outcome.status === "cancelled" && result.timedOut) {
          warnings.push("Run timed out before cancellation propagated.");
        }

        // Build a pre-final metadata snapshot for the QMO summary step.
        // The QMO step emits its own warnings (QG-unreadable, QMO-persist
        // failure, etc) which we merge into `warnings` BEFORE the final
        // writeMetadata so the persisted run record reflects them.
        const preFinalCompleted: RunMetadata = {
          ...runningMetadata,
          status: outcome.status,
          exitCode: outcome.exitCode,
          signal: outcome.signal,
          cancelReason: outcome.status === "cancelled" ? outcome.cancelReason : undefined,
          durationMs: outcome.durationMs,
          completedAt: new Date().toISOString(),
          summary: summary?.summary,
          warnings
        };
        // T207 review fix: QMO step runs BEFORE final writeMetadata so
        // its warnings (QG read failures, QMO persist failures) are
        // captured in the persisted RunMetadata.warnings array. The
        // step itself uses `preFinalCompleted` for the QMO summary
        // input — the QMO file does NOT include the QMO step's own
        // warnings (avoids self-reference; consumers see them via
        // RunMetadata.warnings).
        const qmoSummaryWarnings = await runQmoSummaryStep({
          runMetadata: preFinalCompleted,
          qmoSummaryJsonPath: paths.qmoSummaryJsonPath,
          qmoSummaryMarkdownPath: paths.qmoSummaryMarkdownPath,
          qualityGateResultPath: paths.qualityGateResultPath,
          runId,
          logger
        });
        const completed: RunMetadata = {
          ...preFinalCompleted,
          warnings: [...preFinalCompleted.warnings, ...qmoSummaryWarnings]
        };
        await artifactsStore.writeMetadata(paths.metadataJson, completed);

        // terminal event ごとに payload shape が異なるため、summary/message の混在をここで防ぐ。
        const terminalEvent: TerminalPublishInput =
          outcome.status === "cancelled"
            ? {
                type: "run.cancelled",
                runId,
                payload: {
                  exitCode: outcome.exitCode,
                  signal: outcome.signal,
                  status: "cancelled",
                  cancelReason: outcome.cancelReason,
                  durationMs: outcome.durationMs,
                  warnings
                }
              }
            : outcome.status === "error"
              ? {
                  type: "run.error",
                  runId,
                  payload: {
                    message: "Run completed with error status.",
                    exitCode: outcome.exitCode,
                    signal: outcome.signal,
                    status: "error",
                    durationMs: outcome.durationMs,
                    warnings
                  }
                }
              : {
                  type: "run.completed",
                  runId,
                  payload: {
                    exitCode: outcome.exitCode,
                    signal: outcome.signal,
                    status: outcome.status === "passed" ? "passed" : "failed",
                    durationMs: outcome.durationMs,
                    summary: summary?.summary,
                    warnings
                  }
                };
        publishTerminalEventSafely({
          bus,
          logger,
          fallbackWarnings: warnings,
          event: terminalEvent
        });
        active.delete(runId);
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
            ...streamRedactor.flush(),
            ...flushStreamPublishWarnings(),
            `Runner failed after spawn. code=${errorCode(error)}`
          ]
        };
        await artifactsStore.writeMetadata(paths.metadataJson, completed);
        publishTerminalEventSafely({
          bus,
          logger,
          fallbackWarnings: completed.warnings,
          event: {
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
          }
        });
        active.delete(runId);
        return completed;
      }
    })();

    const activeHandle: ActiveRunHandle = {
      runId,
      metadata: runningMetadata,
      finished,
      cancel(reason?: RunCancellationReason) {
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
    const outcome = await artifactsStore.redactPlaywrightResults(playwrightJsonPath);
    if (outcome.modified) {
      logger?.info?.(
        {
          runId,
          artifactKind: "playwright-json" satisfies ArtifactKind,
          op: "redaction" satisfies ArtifactOperation,
          replacements: outcome.replacements
        },
        "playwright-results redaction applied"
      );
    }
    return undefined;
  } catch (error) {
    const redactionCode = errorCode(error);
    logger?.error(
      {
        runId,
        artifactKind: "playwright-json" satisfies ArtifactKind,
        op: "redaction" satisfies ArtifactOperation,
        ...errorLogFields(error)
      },
      "playwright-results redaction failed"
    );
    try {
      await fs.unlink(playwrightJsonPath);
      return `Playwright JSON redaction failed; removed raw result artifact. redactionCode=${redactionCode}`;
    } catch (unlinkError) {
      const unlinkCode = errorCode(unlinkError);
      // 削除失敗も "redaction" operation のクリーンアップ失敗 (raw artifact が
      // 残るリスク) として扱う。identity は同じ playwright-json。
      //
      // Issue #31 注記: 上の redact-throw とこの unlink-throw は
      // `{ artifactKind, op }` の 2 軸が同一なので、log-aggregator query で
      // 区別したい場合は `code` (redact 側は redactPlaywrightResults の例外、
      // 多くは EACCES/EROFS など。unlink 側は ENOENT/EBUSY など) と
      // log message ("playwright-results redaction failed" vs
      // "failed to remove raw playwright-results artifact after redaction
      // failure") を併用する。`artifactKind` + `op` だけでは唯一識別できない
      // 設計を意図しており、運用 query 側で discriminator を組む必要がある。
      logger?.error(
        {
          runId,
          artifactKind: "playwright-json" satisfies ArtifactKind,
          op: "redaction" satisfies ArtifactOperation,
          ...errorLogFields(unlinkError)
        },
        "failed to remove raw playwright-results artifact after redaction failure"
      );
      return `Playwright JSON redaction failed; raw result artifact may still contain secrets. redactionCode=${redactionCode}; removalCode=${unlinkCode}`;
    }
  }
}

/**
 * Phase 1.2 archive step (T203-3). Pre-run hook that protects user-side
 * `allure-results/*` from the previous run by moving entries into a
 * timestamped archive subdirectory before Playwright launches. No-op when
 * `params.allureResultsDir` is undefined (project does not use Allure or
 * the value failed validation in T203-1).
 *
 * Failure semantics: FATAL_OPERATIONAL_CODES from the helper propagate
 * here and re-throw so the caller (route) returns 500 with a stable
 * code. PLAN.v2 §22's user-data-preservation invariant takes priority
 * over allowing the run to start.
 */
async function runArchiveStep({
  projectRoot,
  allureResultsDir,
  runId,
  artifactsStore,
  logger
}: {
  projectRoot: string;
  allureResultsDir: string | undefined;
  runId: string;
  artifactsStore: RunArtifactsStore;
  logger?: RunManagerLogger;
}): Promise<string[]> {
  if (!allureResultsDir) return [];
  const sourceAbs = path.resolve(projectRoot, allureResultsDir);
  try {
    const outcome = await artifactsStore.archiveAllureResultsDir(projectRoot, sourceAbs);
    return outcome.warnings;
  } catch (error) {
    // Archive op identified as a "redaction" of user data into a safe
    // location (Issue #31 axes: identity = `allure-results`,
    // operation = `redaction`). Same shape as Playwright JSON redaction
    // logging.
    logger?.error(
      {
        runId,
        artifactKind: "allure-results" satisfies ArtifactKind,
        op: "redaction" satisfies ArtifactOperation,
        ...errorLogFields(error)
      },
      "allure-results archive failed"
    );
    throw error;
  }
}

/**
 * Phase 1.2 copy step (T203-3). Post-run hook that materializes the
 * user's freshly-written `allure-results/*` into `<runDir>/allure-results/`
 * so AllureReportProvider can read a stable, run-scoped snapshot. Failures
 * are non-fatal — the test run already finished, so we surface a structured
 * error log + a warning rather than aborting the post-run pipeline.
 *
 * Returns warnings (path-redacted) for inclusion in `RunMetadata.warnings`.
 */
async function runCopyStep({
  projectRoot,
  allureResultsDir,
  allureResultsDest,
  runId,
  artifactsStore,
  logger
}: {
  projectRoot: string;
  allureResultsDir: string | undefined;
  allureResultsDest: string;
  runId: string;
  artifactsStore: RunArtifactsStore;
  logger?: RunManagerLogger;
}): Promise<string[]> {
  if (!allureResultsDir) return [];
  const sourceAbs = path.resolve(projectRoot, allureResultsDir);
  try {
    const outcome = await artifactsStore.copyAllureResultsDir(sourceAbs, allureResultsDest);
    return outcome.warnings;
  } catch (error) {
    // Copy op is plain artifact materialization (no operation axis — the
    // run-scoped allure-results directory is the artifact being created).
    // Identity-only log keeps the operation axis available for redaction
    // / summary-extract follow-ups (T206 / T207).
    logger?.error(
      {
        runId,
        artifactKind: "allure-results" satisfies ArtifactKind,
        ...errorLogFields(error)
      },
      "allure-results copy failed"
    );
    return [
      `Allure-results copy failed; run-scoped artifact may be incomplete. code=${errorCode(error)}`
    ];
  }
}

/**
 * Phase 1.2 report-generation step (T204-3). Post-copy hook that invokes
 * `allure generate` to produce the HTML report under
 * `<runDir>/allure-report/`. Skipped when `allureResultsDir` is undefined
 * (project does not use Allure) or when no Allure runner is wired (test
 * environments / CLI not installed). Failures are NON-fatal — the run
 * already produced raw allure-results that downstream phases (T205
 * Quality Gate, T207 QMO) can still consume.
 *
 * Logs structured info on success and structured error on failure, both
 * with `artifactKind: "allure-report"` (no operation axis — generation
 * is the artifact's identity-lifecycle event).
 */
async function runReportGenerationStep({
  projectRoot,
  allureResultsDir,
  allureResultsDest,
  allureReportDir,
  historyPath,
  runId,
  allureRunner,
  logger
}: {
  projectRoot: string;
  allureResultsDir: string | undefined;
  allureResultsDest: string;
  allureReportDir: string;
  historyPath: string;
  runId: string;
  allureRunner: CommandRunner | undefined;
  logger?: RunManagerLogger;
}): Promise<string[]> {
  if (!allureResultsDir || !allureRunner) return [];
  // Pre-check empty source: when the run produced zero allure-results
  // files (e.g. tests printed nothing, or the user wiped the dir between
  // archive and run), Allure CLI returns a misleading "Could not find
  // any allure results" exit code. Surface this preconditional failure
  // up front with a stable structured-log code so operators see the
  // actual cause instead of a generic "exit code 1".
  let entryCount = 0;
  try {
    const entries = await fs.readdir(allureResultsDest);
    entryCount = entries.length;
  } catch {
    // ENOENT or other read failure → 0 entries. The detail is logged
    // below via the same "no-results" path.
    entryCount = 0;
  }
  if (entryCount === 0) {
    logger?.warn?.(
      {
        runId,
        artifactKind: "allure-report" satisfies ArtifactKind,
        failureMode: "no-results"
      },
      "allure HTML report skipped: no results in run-scoped allure-results"
    );
    return [
      "Allure HTML report skipped: no results in run-scoped allure-results."
    ];
  }
  // Lazy import to keep the module tree shallow — generator pulls in fs
  // existence checks that are unnecessary for runs without Allure.
  const { generateAllureReport } = await import("./allureReportGenerator.js");
  const outcome = await generateAllureReport({
    runner: allureRunner,
    projectRoot,
    allureResultsDest,
    allureReportDir,
    historyPath
  });
  if (outcome.ok) {
    logger?.info?.(
      {
        runId,
        artifactKind: "allure-report" satisfies ArtifactKind,
        durationMs: outcome.durationMs,
        exitCode: outcome.exitCode ?? 0
      },
      "allure HTML report generated"
    );
  } else {
    // Identity-only error log (no op): generation is the artifact's
    // lifecycle event itself, not a sub-operation on an existing
    // artifact (Issue #31 axes convention). `failureMode` discriminates
    // timeout vs exit-nonzero vs spawn-error vs binary-missing so log
    // aggregator queries can branch without parsing warning strings.
    logger?.error(
      {
        runId,
        artifactKind: "allure-report" satisfies ArtifactKind,
        failureMode: outcome.failureMode,
        ...(outcome.errorCode !== undefined ? { code: outcome.errorCode } : {}),
        exitCode: outcome.exitCode,
        durationMs: outcome.durationMs
      },
      "allure HTML report generation failed"
    );
  }
  return outcome.warnings;
}

/**
 * Phase 1.2 quality-gate step (T205-2). Evaluates Allure's
 * `quality-gate` subcommand and persists the QualityGateResult JSON
 * (`<runDir>/quality-gate-result.json`, conforming to
 * `QualityGateResultSchema` in `@pwqa/shared`) for QMO consumers.
 *
 * Skip path: when `allureResultsDir` is undefined OR no Allure runner
 * was wired, return early without persisting (no QG meaningful).
 *
 * Pre-check empty source: zero entries in the run-scoped allure-results
 * directory mirrors the report-generation pre-check (T204-3 review). The
 * function returns a structured "no-results" warning and skips the
 * subprocess so the operator sees the actual cause rather than a
 * misleading Allure CLI error code.
 *
 * Failures are NON-fatal — Playwright already finished. Structured logs
 * use `artifactKind: "allure-report"` (Quality Gate is an evaluation of
 * the same identity, so it shares the artifact axis; failureMode
 * discriminates the path) — keeping a separate `"quality-gate"`
 * identity is deferred to T205 follow-up if QMO query needs require it.
 */
async function runQualityGateStep({
  projectRoot,
  allureResultsDir,
  allureResultsDest,
  qualityGateResultPath,
  profile,
  runId,
  allureRunner,
  logger
}: {
  projectRoot: string;
  allureResultsDir: string | undefined;
  allureResultsDest: string;
  qualityGateResultPath: string;
  profile: import("@pwqa/shared").QualityGateProfile;
  runId: string;
  allureRunner: CommandRunner | undefined;
  logger?: RunManagerLogger;
}): Promise<string[]> {
  if (!allureResultsDir || !allureRunner) return [];
  // Pre-check empty source — same rationale as report-generation hook.
  let entryCount = 0;
  try {
    const entries = await fs.readdir(allureResultsDest);
    entryCount = entries.length;
  } catch {
    entryCount = 0;
  }
  if (entryCount === 0) {
    logger?.warn?.(
      {
        runId,
        artifactKind: "allure-report" satisfies ArtifactKind,
        failureMode: "no-results"
      },
      "allure quality-gate skipped: no results in run-scoped allure-results"
    );
    return [
      "Allure quality-gate skipped: no results in run-scoped allure-results."
    ];
  }
  const { evaluateAllureQualityGate, persistQualityGateResult } = await import(
    "./allureQualityGate.js"
  );
  const { resolveQualityGateRules } = await import("./qualityGateProfiles.js");
  // §1.4: Resolve effective rules from the project's optional override file
  // (`.playwright-workbench/config/quality-gate-profiles.json`) merged on
  // top of built-in defaults. Override-load failures degrade to a warning
  // but do NOT block the QG run — the built-in defaults still apply.
  const resolved = await resolveQualityGateRules(projectRoot, profile);
  const outcome = await evaluateAllureQualityGate({
    runner: allureRunner,
    projectRoot,
    allureResultsDest,
    profile: resolved.profile,
    rules: resolved.rules
  });
  if (outcome.persisted) {
    try {
      await persistQualityGateResult(qualityGateResultPath, outcome.persisted);
    } catch (error) {
      // FATAL_OPERATIONAL_CODES propagate even on the persistence path:
      // ENOSPC / EDQUOT / EROFS / EACCES / EIO during the write means
      // the next persistence attempt will fail too, AND it means the
      // QualityGateResult was lost (no JSON file). Demoting that to a
      // warning silently drops the persisted source-of-truth — QMO
      // consumers reading the missing file would see ENOENT and have
      // no way to distinguish "Allure not configured" from "disk full".
      // Mirrors T204-3 fatal-propagation policy on the runner half.
      const code = errorCode(error);
      if (PERSIST_FATAL_CODES.has(code)) {
        throw error;
      }
      logger?.error(
        {
          runId,
          artifactKind: "allure-report" satisfies ArtifactKind,
          failureMode: "persist-error",
          ...errorLogFields(error)
        },
        "failed to persist quality-gate-result.json"
      );
      return [
        ...resolved.warnings,
        ...outcome.warnings,
        `Allure quality-gate result could not be persisted. code=${code}`
      ];
    }
  }
  if (outcome.status === "passed") {
    logger?.info?.(
      {
        runId,
        artifactKind: "allure-report" satisfies ArtifactKind,
        durationMs: outcome.durationMs,
        qualityGateStatus: "passed",
        exitCode: 0
      },
      "allure quality-gate passed"
    );
  } else {
    logger?.error(
      {
        runId,
        artifactKind: "allure-report" satisfies ArtifactKind,
        qualityGateStatus: outcome.status,
        failureMode: outcome.failureMode,
        ...(outcome.errorCode !== undefined ? { code: outcome.errorCode } : {}),
        exitCode: outcome.exitCode,
        durationMs: outcome.durationMs
      },
      "allure quality-gate did not pass"
    );
  }
  return [...resolved.warnings, ...outcome.warnings];
}

/**
 * Phase 1.2 QMO summary step (T207). Generates the Release Readiness
 * Summary v0 (JSON + Markdown) from the completed RunMetadata + Quality
 * Gate result and persists both forms. Returns warnings so the caller
 * can merge them into `RunMetadata.warnings` BEFORE the final
 * `writeMetadata` — otherwise QG-read failures and QMO-persist failures
 * would have no observable trace in the persisted run record.
 *
 * Failure is NON-fatal for run completion: Playwright already finished.
 * `PERSIST_FATAL_CODES` (ENOSPC / EDQUOT / EROFS / EACCES / EIO / FD
 * exhaustion) propagate so the caller surfaces a single actionable
 * error rather than burying it in warnings (T205-2 review precedent).
 */
async function runQmoSummaryStep({
  runMetadata,
  qmoSummaryJsonPath,
  qmoSummaryMarkdownPath,
  qualityGateResultPath,
  runId,
  logger
}: {
  runMetadata: RunMetadata;
  qmoSummaryJsonPath: string;
  qmoSummaryMarkdownPath: string;
  qualityGateResultPath: string;
  runId: string;
  logger?: RunManagerLogger;
}): Promise<string[]> {
  const { buildQmoSummary, persistQmoSummary, readPersistedQualityGate } = await import(
    "../reporting/qmoSummary.js"
  );
  const warnings: string[] = [];
  // T207 review fix: distinguish ENOENT (legitimate skip) from
  // unreadable conditions (EACCES / EIO / malformed JSON). An unreadable
  // QG result that was successfully written by a prior step would
  // otherwise silently downgrade the QMO outcome from "not-ready" to
  // "ready" based on tests alone.
  const qgRead = await readPersistedQualityGate(qualityGateResultPath);
  let qualityGateResult = undefined;
  if (qgRead.kind === "found") {
    qualityGateResult = qgRead.value;
  } else if (qgRead.kind === "unreadable") {
    warnings.push(
      `Quality-gate result was previously written but could not be read for QMO summary. code=${qgRead.code}`
    );
  }
  // The QMO summary embeds `runMetadata.warnings` (excluding the
  // about-to-be-added qmo warnings) so failures from earlier steps
  // are reflected. The summary's own warnings flow back through the
  // returned list to the caller's metadata.warnings merge.
  const summary = buildQmoSummary({ runMetadata, qualityGateResult });
  try {
    await persistQmoSummary(qmoSummaryJsonPath, qmoSummaryMarkdownPath, summary);
    logger?.info?.(
      {
        runId,
        artifactKind: "metadata" satisfies ArtifactKind,
        outcome: summary.outcome
      },
      "qmo summary persisted"
    );
  } catch (error) {
    const code = errorCode(error);
    if (PERSIST_FATAL_CODES.has(code)) {
      throw error;
    }
    logger?.error(
      {
        runId,
        artifactKind: "metadata" satisfies ArtifactKind,
        ...errorLogFields(error)
      },
      "failed to persist qmo summary"
    );
    warnings.push(
      `QMO summary could not be persisted. code=${code}`
    );
  }
  return warnings;
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
        artifactKind: "playwright-json" satisfies ArtifactKind,
        op: "summary-extract" satisfies ArtifactOperation,
        ...errorLogFields(error)
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
          artifactKind: "runs-directory" satisfies ArtifactKind,
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
            artifactKind: "metadata" satisfies ArtifactKind,
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
          artifactKind: "metadata" satisfies ArtifactKind,
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
          artifactKind: "metadata" satisfies ArtifactKind,
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
