import { Hono } from "hono";
import { ProjectOpenRequestSchema, type TestInventory } from "@pwqa/shared";
import { scanProject, ProjectScanError } from "../project/scanner.js";
import { buildInventory } from "../project/inventory.js";
import type { ProjectStore } from "../project/store.js";
import type { CommandRunner } from "../commands/runner.js";
import { apiError } from "../lib/apiError.js";

interface Deps {
  projectStore: ProjectStore;
  runner: CommandRunner;
  allowedRoots: ReadonlyArray<string>;
}

export function projectsRoutes({ projectStore, runner, allowedRoots }: Deps): Hono {
  const router = new Hono();

  router.post("/projects/open", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = ProjectOpenRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(
        c,
        "INVALID_INPUT",
        parsed.error.issues.map((issue) => issue.message).join("; "),
        400
      );
    }
    try {
      const result = await scanProject({
        rootPath: parsed.data.rootPath,
        packageManagerOverride: parsed.data.packageManagerOverride,
        allowedRoots
      });
      projectStore.set(result);
      return c.json(result.summary);
    } catch (error) {
      if (error instanceof ProjectScanError) {
        const status = error.code === "PROJECT_NOT_ALLOWED" ? 403 : 400;
        return apiError(c, error.code, error.message, status);
      }
      return apiError(
        c,
        "INTERNAL",
        error instanceof Error ? error.message : "Failed to scan project",
        500
      );
    }
  });

  router.get("/projects/current", (c) => {
    const current = projectStore.get();
    if (!current) {
      return apiError(c, "NO_PROJECT", "No project is currently open.", 404);
    }
    return c.json(current.summary);
  });

  router.get("/projects/:projectId/inventory", async (c) => {
    const projectId = c.req.param("projectId");
    const current = projectStore.getById(projectId);
    if (!current) {
      return apiError(c, "NO_PROJECT", "Project is not open.", 404);
    }
    const inventory: TestInventory = await buildInventory({
      projectId: current.summary.id,
      projectRoot: current.summary.rootPath,
      packageManager: current.packageManager,
      runner
    });
    return c.json(inventory);
  });

  return router;
}
