import type { Context } from "hono";
import { Hono } from "hono";
import {
  RunRequestSchema,
  type RunListItem,
  type RunListResponse,
  type RunMetadata
} from "@pwqa/shared";
import type { RunManager, RunManagerLogger } from "../playwright/runManager.js";
import { mergeActiveAndPersistedRuns } from "../playwright/runManager.js";
import type { ProjectStore } from "../project/store.js";
import { apiError } from "../lib/apiError.js";
import { pathExists } from "../lib/pathExists.js";

interface Deps {
  projectStore: ProjectStore;
  runManager: RunManager;
  logger?: RunManagerLogger;
}

export function runsRoutes({ projectStore, runManager, logger }: Deps): Hono {
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
        request: parsed.data
      });
      return c.json({ runId: handle.runId, metadata: handle.metadata }, 202);
    } catch (error) {
      return apiError(
        c,
        "RUN_FAILED",
        error instanceof Error ? error.message : "Failed to start run",
        500
      );
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
