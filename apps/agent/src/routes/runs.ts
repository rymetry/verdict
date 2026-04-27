import { Hono } from "hono";
import { RunRequestSchema, type RunListItem, type RunListResponse } from "@pwqa/shared";
import type { RunManager } from "../playwright/runManager.js";
import { loadRunsFromDisk } from "../playwright/runManager.js";
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
    const runs = await loadRunsFromDisk(current.summary.rootPath);
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
    const runs = await loadRunsFromDisk(current.summary.rootPath);
    const run = runs.find((r) => r.runId === runId);
    if (!run) {
      return c.json(
        { error: { code: "NOT_FOUND", message: `Run ${runId} not found.` } },
        404
      );
    }
    return c.json(run);
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
