import { Hono } from "hono";
import {
  ProjectOpenRequestSchema,
  type TestInventory
} from "@pwqa/shared";
import { scanProject, ProjectScanError } from "../project/scanner.js";
import { buildInventory } from "../project/inventory.js";
import type { ProjectStore } from "../project/store.js";
import type { CommandRunner } from "../commands/runner.js";

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
        return c.json(
          { error: { code: error.code, message: error.message } },
          status
        );
      }
      return c.json(
        {
          error: {
            code: "INTERNAL",
            message: error instanceof Error ? error.message : "Failed to scan project"
          }
        },
        500
      );
    }
  });

  router.get("/projects/current", (c) => {
    const current = projectStore.get();
    if (!current) {
      return c.json(
        { error: { code: "NO_PROJECT", message: "No project is currently open." } },
        404
      );
    }
    return c.json(current.summary);
  });

  router.get("/projects/:projectId/inventory", async (c) => {
    const projectId = c.req.param("projectId");
    const current = projectStore.getById(projectId);
    if (!current) {
      return c.json(
        { error: { code: "NO_PROJECT", message: "Project is not open." } },
        404
      );
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
