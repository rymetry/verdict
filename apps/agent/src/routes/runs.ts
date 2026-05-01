import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Context } from "hono";
import { Hono } from "hono";
import {
  AiAnalysisRequestSchema,
  AiAnalysisResponseSchema,
  type AiAnalysisResponse,
  QmoSummarySchema,
  ReleaseReviewDraftRequestSchema,
  RepairComparisonSchema,
  RepairRerunResponseSchema,
  RunRequestSchema,
  FailureReviewResponseSchema,
  type RunListItem,
  type RunListResponse,
  type RunMetadata
} from "@pwqa/shared";
import type { RunManager, RunManagerLogger } from "../playwright/runManager.js";
import { mergeActiveAndPersistedRuns } from "../playwright/runManager.js";
import { errorLogFields, projectIdHash } from "../lib/structuredLog.js";
import type { ProjectStore } from "../project/store.js";
import { apiError } from "../lib/apiError.js";
import { pathExists } from "../lib/pathExists.js";
import { CommandPolicyError } from "../commands/runner.js";
import { PlaywrightCommandBuildError } from "../playwright/builder.js";
import { AuditPersistenceError } from "../lib/errors.js";
import { buildFailureReview } from "../reporting/failureReview.js";
import { buildAiAnalysisContext } from "../ai/analysisContext.js";
import { AiAnalysisError, type AiAnalysisAdapter } from "../ai/cliAdapter.js";
import { buildReleaseReviewDraft } from "../reporting/releaseReviewDraft.js";
import {
  isValidRunIdSegment,
  persistRepairComparison,
  readRepairComparison,
  repairComparisonPathFor
} from "../repair/repairComparison.js";

/**
 * Maps startup failures to stable public codes. Structured logs use the
 * fail-closed `errorLogFields(error)` helper so raw error messages — which
 * can carry cwd, realpath, or secret-adjacent text — never reach pino.
 */
function startupFailureResponse(error: unknown): {
  code: string;
  message: string;
  status: 400 | 500;
} {
  if (error instanceof PlaywrightCommandBuildError) {
    return {
      code: "RUN_COMMAND_BUILD_FAILED",
      message: "Run command could not be built from the request.",
      status: 400
    };
  }
  if (error instanceof CommandPolicyError) {
    return {
      code: "RUN_COMMAND_REJECTED",
      message: "Runner rejected the command before spawn.",
      status: 400
    };
  }
  if (error instanceof AuditPersistenceError) {
    return {
      code: "RUN_AUDIT_PERSIST_FAILED",
      message: "Run could not start because audit logging failed.",
      status: 500
    };
  }
  return {
    code: "RUN_START_FAILED",
    message: "Run failed before it could be started.",
    status: 500
  };
}

interface Deps {
  projectStore: ProjectStore;
  runManager: RunManager;
  logger?: RunManagerLogger;
  aiAdapterForProject: (projectRoot: string) => AiAnalysisAdapter;
}

export function runsRoutes({ projectStore, runManager, logger, aiAdapterForProject }: Deps): Hono {
  const router = new Hono();

  router.post("/runs", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = RunRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        c,
        "INVALID_INPUT",
        parsed.error.issues.map((i) => i.message).join("; "),
        400
      );
    }
    const current = projectStore.getById(parsed.data.projectId);
    if (!current) return apiError(c, "NO_PROJECT", "Project is not open.", 404);
    if (current.packageManager.blockingExecution) {
      return apiError(
        c,
        "RUN_BLOCKED",
        current.packageManager.errors.join(" ") ||
          "Run blocked by package manager status.",
        409
      );
    }
    try {
      const handle = await runManager.startRun({
        projectId: current.summary.id,
        projectRoot: current.summary.rootPath,
        packageManager: current.packageManager,
        request: parsed.data,
        // Phase 1.2 (T203-3): wire the resultsDir detected by ProjectScanner
        // (T203-1) so RunManager's archive/copy lifecycle activates when
        // the project uses allure-playwright. Undefined → lifecycle no-op.
        allureResultsDir: current.summary.allureResultsDir,
        hasAllurePlaywright: current.summary.hasAllurePlaywright
      });
      return c.json({ runId: handle.runId, metadata: handle.metadata }, 202);
    } catch (error) {
      logger?.error(
        {
          // `current.summary.id` is the project realpath (scanner.ts:174);
          // hash it so structured logs don't leak `/Users/<name>/...`.
          projectIdHash: projectIdHash(current.summary.id),
          ...errorLogFields(error)
        },
        "run start failed"
      );
      const response = startupFailureResponse(error);
      return apiError(c, response.code, response.message, response.status);
    }
  });

  router.get("/runs", async (c) => {
    const current = projectStore.get();
    if (!current) {
      const empty: RunListResponse = { runs: [] };
      return c.json(empty);
    }
    const runs = await mergeActiveAndPersistedRuns(runManager, current.summary.rootPath, logger);
    const listed: RunListItem[] = runs.map(toListItem);
    return c.json({ runs: listed } satisfies RunListResponse);
  });

  router.get("/runs/:runId", async (c) => {
    const result = await loadRun(c, runManager, projectStore, logger);
    if (!("run" in result)) return result.response;
    return c.json(result.run);
  });

  router.get("/runs/:runId/artifacts", async (c) => {
    const result = await loadRun(c, runManager, projectStore, logger);
    if (!("run" in result)) return result.response;
    const { run } = result;
    return c.json({
      runId: run.runId,
      paths: run.paths,
      hasPlaywrightJson: await pathExists(run.paths.playwrightJson),
      hasPlaywrightHtml: await pathExists(run.paths.playwrightHtml),
      hasStdoutLog: await pathExists(run.paths.stdoutLog),
      hasStderrLog: await pathExists(run.paths.stderrLog)
    });
  });

  router.get("/runs/:runId/report-summary", async (c) => {
    const result = await loadRun(c, runManager, projectStore, logger);
    if (!("run" in result)) return result.response;
    const { run } = result;
    if (!run.summary) {
      return apiError(
        c,
        "NO_SUMMARY",
        "Playwright JSON summary is not yet available for this run.",
        409
      );
    }
    return c.json({
      runId: run.runId,
      summary: run.summary,
      status: run.status,
      completedAt: run.completedAt
    });
  });

  router.get("/runs/:runId/failure-review", async (c) => {
    const result = await loadRun(c, runManager, projectStore, logger);
    if (!("run" in result)) return result.response;
    try {
      const review = await buildFailureReview({
        run: result.run,
        projectRoot: result.run.projectRoot
      });
      return c.json(FailureReviewResponseSchema.parse(review));
    } catch (error) {
      logger?.error(
        {
          runId: result.run.runId,
          artifactKind: "metadata",
          ...errorLogFields(error)
        },
        "failure-review read failed"
      );
      return apiError(
        c,
        "FAILURE_REVIEW_READ_FAILED",
        "Failure review data could not be derived for this run.",
        500
      );
    }
  });

  router.post("/runs/:runId/ai-analysis", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = AiAnalysisRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        c,
        "INVALID_INPUT",
        parsed.error.issues.map((i) => i.message).join("; "),
        400
      );
    }
    const result = await loadRun(c, runManager, projectStore, logger);
    if (!("run" in result)) return result.response;
    const { run } = result;
    if (run.status === "queued" || run.status === "running") {
      return apiError(
        c,
        "AI_ANALYSIS_NOT_READY",
        "AI analysis requires a completed run.",
        409
      );
    }
    try {
      const failureReview = await buildFailureReview({ run, projectRoot: run.projectRoot });
      if (failureReview.failedTests.length === 0) {
        return apiError(
          c,
          "AI_ANALYSIS_NO_FAILURES",
          "AI analysis requires at least one failed test.",
          409
        );
      }
      const context = await buildAiAnalysisContext({ run, failureReview });
      const analysis = await aiAdapterForProject(run.projectRoot).analyze({
        provider: parsed.data.provider,
        projectRoot: run.projectRoot,
        context
      });
      const response = AiAnalysisResponseSchema.parse({
        runId: run.runId,
        projectId: context.projectId,
        provider: parsed.data.provider,
        generatedAt: new Date().toISOString(),
        analysis,
        warnings: context.warnings
      } satisfies AiAnalysisResponse);
      await fs.writeFile(
        aiAnalysisPathFor(run),
        `${JSON.stringify(response, null, 2)}\n`,
        "utf8"
      );
      return c.json(response);
    } catch (error) {
      logger?.error(
        {
          runId: run.runId,
          artifactKind: "ai-analysis",
          ...errorLogFields(error)
        },
        "ai-analysis failed"
      );
      if (error instanceof CommandPolicyError) {
        return apiError(
          c,
          "AI_COMMAND_REJECTED",
          "AI command was rejected before spawn.",
          400
        );
      }
      if (error instanceof AiAnalysisError) {
        const status = error.code === "AI_CLI_TIMED_OUT" ? 504 : 502;
        return apiError(
          c,
          error.code,
          "AI analysis could not be completed.",
          status
        );
      }
      return apiError(
        c,
        "AI_ANALYSIS_FAILED",
        "AI analysis could not be completed.",
        500
      );
    }
  });

  /**
   * Phase 1.2 / T208-1: serves the persisted QMO Release Readiness Summary
   * (`<runDir>/qmo-summary.json`) produced by RunManager's runQmoSummaryStep.
   *
   * Response codes:
   *   - 200: persisted JSON parsed successfully against `QmoSummarySchema`.
   *   - 404 NO_PROJECT / NOT_FOUND: standard `loadRun` errors (no project,
   *     run id missing).
   *   - 409 NO_QMO_SUMMARY: file is absent (run still in progress, project
   *     does not use Allure, or the summary step skipped earlier).
   *   - 500 INVALID_QMO_SUMMARY: file exists but is malformed JSON or
   *     fails schema validation. Caller's structured log records the
   *     code via `errorLogFields(error)` so the absolute path stays
   *     out of the response.
   */
  router.get("/runs/:runId/qmo-summary", async (c) => {
    const result = await loadRun(c, runManager, projectStore, logger);
    if (!("run" in result)) return result.response;
    const { run } = result;
    let raw: string;
    try {
      raw = await fs.readFile(run.paths.qmoSummaryJsonPath, "utf8");
    } catch (error) {
      const code =
        error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"
          ? (error as { code: string }).code
          : "READ_FAILED";
      if (code === "ENOENT") {
        return apiError(
          c,
          "NO_QMO_SUMMARY",
          "QMO summary not yet generated for this run.",
          409
        );
      }
      logger?.error(
        {
          runId: run.runId,
          artifactKind: "metadata",
          ...errorLogFields(error)
        },
        "qmo-summary read failed"
      );
      return apiError(
        c,
        "QMO_SUMMARY_READ_FAILED",
        `QMO summary file could not be read. code=${code}`,
        500
      );
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      logger?.error(
        {
          runId: run.runId,
          artifactKind: "metadata",
          code: "INVALID_JSON"
        },
        "qmo-summary contained invalid JSON"
      );
      return apiError(
        c,
        "INVALID_QMO_SUMMARY",
        "Persisted QMO summary is not valid JSON.",
        500
      );
    }
    const validated = QmoSummarySchema.safeParse(parsedJson);
    if (!validated.success) {
      logger?.error(
        {
          runId: run.runId,
          artifactKind: "metadata",
          code: "SCHEMA_MISMATCH",
          issues: validated.error.issues.map((i) => i.path.join(".")).join(",")
        },
        "qmo-summary failed schema validation"
      );
      return apiError(
        c,
        "INVALID_QMO_SUMMARY",
        "Persisted QMO summary failed schema validation.",
        500
      );
    }
    return c.json(validated.data);
  });

  /**
   * Phase 1.2 / T208-1: Markdown form of the QMO summary. Same lifecycle
   * as the JSON endpoint above; served as `text/markdown` for direct
   * embedding in PR comments / chat tools that handle markdown natively.
   */
  router.get("/runs/:runId/qmo-summary.md", async (c) => {
    const result = await loadRun(c, runManager, projectStore, logger);
    if (!("run" in result)) return result.response;
    const { run } = result;
    let body: string;
    try {
      body = await fs.readFile(run.paths.qmoSummaryMarkdownPath, "utf8");
    } catch (error) {
      const code =
        error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"
          ? (error as { code: string }).code
          : "READ_FAILED";
      if (code === "ENOENT") {
        return apiError(
          c,
          "NO_QMO_SUMMARY",
          "QMO summary markdown not yet generated for this run.",
          409
        );
      }
      logger?.error(
        {
          runId: run.runId,
          artifactKind: "metadata",
          ...errorLogFields(error)
        },
        "qmo-summary markdown read failed"
      );
      return apiError(
        c,
        "QMO_SUMMARY_READ_FAILED",
        `QMO summary markdown could not be read. code=${code}`,
        500
      );
    }
    return c.body(body, 200, { "Content-Type": "text/markdown; charset=utf-8" });
  });

  router.post("/runs/:runId/release-review-draft", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = ReleaseReviewDraftRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        c,
        "INVALID_INPUT",
        parsed.error.issues.map((i) => i.message).join("; "),
        400
      );
    }
    const result = await loadRun(c, runManager, projectStore, logger);
    if (!("run" in result)) return result.response;
    const { run } = result;
    let raw: string;
    try {
      raw = await fs.readFile(run.paths.qmoSummaryJsonPath, "utf8");
    } catch (error) {
      const code =
        error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"
          ? (error as { code: string }).code
          : "READ_FAILED";
      if (code === "ENOENT") {
        return apiError(
          c,
          "NO_QMO_SUMMARY",
          "QMO summary is required before a release review draft can be generated.",
          409
        );
      }
      logger?.error(
        {
          runId: run.runId,
          artifactKind: "metadata",
          ...errorLogFields(error)
        },
        "release review draft qmo-summary read failed"
      );
      return apiError(
        c,
        "QMO_SUMMARY_READ_FAILED",
        `QMO summary file could not be read. code=${code}`,
        500
      );
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      logger?.error(
        {
          runId: run.runId,
          artifactKind: "metadata",
          code: "INVALID_JSON"
        },
        "release review draft qmo-summary contained invalid JSON"
      );
      return apiError(
        c,
        "INVALID_QMO_SUMMARY",
        "Persisted QMO summary is not valid JSON.",
        500
      );
    }
    const qmoSummary = QmoSummarySchema.safeParse(parsedJson);
    if (!qmoSummary.success) {
      logger?.error(
        {
          runId: run.runId,
          artifactKind: "metadata",
          code: "SCHEMA_MISMATCH",
          issues: qmoSummary.error.issues.map((i) => i.path.join(".")).join(",")
        },
        "release review draft qmo-summary failed schema validation"
      );
      return apiError(
        c,
        "INVALID_QMO_SUMMARY",
        "Persisted QMO summary failed schema validation.",
        500
      );
    }
    return c.json(buildReleaseReviewDraft({ qmoSummary: qmoSummary.data, request: parsed.data }));
  });

  router.post("/runs/:runId/repair-rerun", async (c) => {
    const result = await loadRun(c, runManager, projectStore, logger);
    if (!("run" in result)) return result.response;
    const { run } = result;
    if (run.status === "queued" || run.status === "running") {
      return apiError(
        c,
        "REPAIR_RERUN_NOT_READY",
        "Repair rerun requires a completed baseline run.",
        409
      );
    }
    const current = projectStore.get();
    if (!current || current.summary.id !== run.projectId) {
      return apiError(c, "NO_PROJECT", "Project is not open.", 404);
    }
    try {
      const handle = await runManager.startRun({
        projectId: current.summary.id,
        projectRoot: current.summary.rootPath,
        packageManager: current.packageManager,
        request: { ...run.requested, projectId: current.summary.id },
        allureResultsDir: current.summary.allureResultsDir,
        hasAllurePlaywright: current.summary.hasAllurePlaywright
      });
      const comparisonPath = repairComparisonPathFor(run, handle.runId);
      void handle.finished
        .then((rerun) => persistRepairComparison({ baseline: run, rerun }))
        .catch((error) => {
          logger?.error(
            {
              runId: run.runId,
              rerunId: handle.runId,
              artifactKind: "metadata",
              ...errorLogFields(error)
            },
            "repair comparison persistence failed"
          );
        });
      return c.json(
        RepairRerunResponseSchema.parse({
          baselineRunId: run.runId,
          rerunId: handle.runId,
          status: "queued",
          comparisonPath
        }),
        202
      );
    } catch (error) {
      logger?.error(
        {
          runId: run.runId,
          projectIdHash: projectIdHash(current.summary.id),
          ...errorLogFields(error)
        },
        "repair rerun start failed"
      );
      const response = startupFailureResponse(error);
      return apiError(c, response.code, response.message, response.status);
    }
  });

  router.get("/runs/:runId/repair-comparison/:rerunId", async (c) => {
    const result = await loadRun(c, runManager, projectStore, logger);
    if (!("run" in result)) return result.response;
    const rerunId = c.req.param("rerunId");
    if (!isValidRunIdSegment(rerunId)) {
      return apiError(c, "INVALID_RERUN_ID", "rerunId is not valid.", 400);
    }
    try {
      const comparison = await readRepairComparison(result.run, rerunId);
      return c.json(RepairComparisonSchema.parse(comparison));
    } catch (error) {
      const code =
        error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"
          ? (error as { code: string }).code
          : "READ_FAILED";
      if (code === "ENOENT") {
        return apiError(
          c,
          "NO_REPAIR_COMPARISON",
          "Repair comparison is not yet generated for this rerun.",
          409
        );
      }
      logger?.error(
        {
          runId: result.run.runId,
          rerunId,
          artifactKind: "metadata",
          ...errorLogFields(error)
        },
        "repair comparison read failed"
      );
      return apiError(
        c,
        "REPAIR_COMPARISON_READ_FAILED",
        "Repair comparison could not be read.",
        500
      );
    }
  });

  router.post("/runs/:runId/cancel", (c) => {
    const runId = c.req.param("runId");
    const cancelled = runManager.cancelRun(runId);
    if (!cancelled) {
      return apiError(c, "NOT_ACTIVE", `Run ${runId} is not currently active.`, 404);
    }
    return c.json({ runId, cancelled: true });
  });

  return router;
}

function aiAnalysisPathFor(run: RunMetadata): string {
  return path.join(run.paths.runDir, "ai-analysis.json");
}

function toListItem(run: RunMetadata): RunListItem {
  return {
    runId: run.runId,
    projectId: run.projectId,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    exitCode: run.exitCode ?? null,
    summary: run.summary,
    warnings: run.warnings
  };
}

type LoadRunResult = { run: RunMetadata } | { response: Response };

async function loadRun(
  c: Context,
  runManager: RunManager,
  projectStore: ProjectStore,
  logger?: RunManagerLogger
): Promise<LoadRunResult> {
  const runId = c.req.param("runId");
  const current = projectStore.get();
  if (!current) {
    return { response: apiError(c, "NO_PROJECT", "Project is not open.", 404) };
  }
  const runs = await mergeActiveAndPersistedRuns(runManager, current.summary.rootPath, logger);
  const run = runs.find((entry) => entry.runId === runId);
  if (!run) {
    return { response: apiError(c, "NOT_FOUND", `Run ${runId} not found.`, 404) };
  }
  return { run };
}
