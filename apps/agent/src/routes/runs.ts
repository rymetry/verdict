import * as fs from "node:fs/promises";
import { Hono } from "hono";
import {
  RunRequestSchema,
  type RunListItem,
  type RunListResponse
} from "@pwqa/shared";
import type { RunManager } from "../playwright/runManager.js";
import { combineRuns } from "../playwright/runManager.js";
import type { ProjectStore } from "../project/store.js";

interface Deps {
  projectStore: ProjectStore;
  runManager: RunManager;
}

export function runsRoutes({ projectStore, runManager }: Deps): Hono {
  const router = new Hono();

  router.post("/runs", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = RunRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        },
        400
      );
    }
    const current = projectStore.getById(parsed.data.projectId);
    if (!current) {
      return c.json(
        { error: { code: "NO_PROJECT", message: "Project is not open." } },
        404
      );
    }
    if (current.packageManager.blockingExecution) {
      return c.json(
        {
          error: {
            code: "RUN_BLOCKED",
            message:
              current.packageManager.errors.join(" ") ||
              "Run blocked by package manager status."
          }
        },
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
      return c.json(
        {
          error: {
            code: "RUN_FAILED",
            message: error instanceof Error ? error.message : "Failed to start run"
          }
        },
        500
      );
    }
  });

  router.get("/runs", async (c): Promise<Response> => {
    const current = projectStore.get();
    if (!current) {
      const empty: RunListResponse = { runs: [] };
      return c.json(empty);
    }
    const runs = await combineRuns(runManager, current.summary.rootPath);
    const listed: RunListItem[] = runs.map((run) => ({
      runId: run.runId,
      projectId: run.projectId,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
      exitCode: run.exitCode ?? null,
      summary: run.summary
    }));
    return c.json({ runs: listed } satisfies RunListResponse);
  });

  router.get("/runs/:runId", async (c) => {
    const runId = c.req.param("runId");
    const current = projectStore.get();
    if (!current) {
      return c.json(
        { error: { code: "NO_PROJECT", message: "Project is not open." } },
        404
      );
    }
    const runs = await combineRuns(runManager, current.summary.rootPath);
    const run = runs.find((r) => r.runId === runId);
    if (!run) {
      return c.json(
        { error: { code: "NOT_FOUND", message: `Run ${runId} not found.` } },
        404
      );
    }
    return c.json(run);
  });

  router.get("/runs/:runId/artifacts", async (c) => {
    const runId = c.req.param("runId");
    const current = projectStore.get();
    if (!current) {
      return c.json(
        { error: { code: "NO_PROJECT", message: "Project is not open." } },
        404
      );
    }
    const runs = await combineRuns(runManager, current.summary.rootPath);
    const run = runs.find((r) => r.runId === runId);
    if (!run) {
      return c.json(
        { error: { code: "NOT_FOUND", message: `Run ${runId} not found.` } },
        404
      );
    }
    return c.json({
      runId,
      paths: run.paths,
      hasPlaywrightJson: await pathExists(run.paths.playwrightJson),
      hasPlaywrightHtml: await pathExists(run.paths.playwrightHtml),
      hasStdoutLog: await pathExists(run.paths.stdoutLog),
      hasStderrLog: await pathExists(run.paths.stderrLog)
    });
  });

  router.get("/runs/:runId/report-summary", async (c) => {
    const runId = c.req.param("runId");
    const current = projectStore.get();
    if (!current) {
      return c.json(
        { error: { code: "NO_PROJECT", message: "Project is not open." } },
        404
      );
    }
    const runs = await combineRuns(runManager, current.summary.rootPath);
    const run = runs.find((r) => r.runId === runId);
    if (!run) {
      return c.json(
        { error: { code: "NOT_FOUND", message: `Run ${runId} not found.` } },
        404
      );
    }
    if (!run.summary) {
      return c.json(
        {
          error: {
            code: "NO_SUMMARY",
            message: "Playwright JSON summary is not yet available for this run."
          }
        },
        409
      );
    }
    return c.json({
      runId,
      summary: run.summary,
      status: run.status,
      completedAt: run.completedAt
    });
  });

  router.post("/runs/:runId/cancel", (c) => {
    const runId = c.req.param("runId");
    const cancelled = runManager.cancelRun(runId);
    if (!cancelled) {
      return c.json(
        {
          error: {
            code: "NOT_ACTIVE",
            message: `Run ${runId} is not currently active.`
          }
        },
        404
      );
    }
    return c.json({ runId, cancelled: true });
  });

  return router;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
