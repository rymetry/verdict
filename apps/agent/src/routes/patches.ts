import { Hono } from "hono";
import {
  PatchApplyResponseSchema,
  PatchCheckResponseSchema,
  PatchRequestSchema,
  PatchRevertResponseSchema,
  type PatchRequest
} from "@pwqa/shared";
import { apiError } from "../lib/apiError.js";
import { errorLogFields, projectIdHash } from "../lib/structuredLog.js";
import type { CurrentProject, ProjectStore } from "../project/store.js";
import type { RunManagerLogger } from "../playwright/runManager.js";
import { PatchValidationError, type PatchManager } from "../git/patchManager.js";
import { CommandPolicyError } from "../commands/runner.js";

interface Deps {
  projectStore: ProjectStore;
  patchManagerForProject: (projectRoot: string) => PatchManager;
  logger?: RunManagerLogger;
}

export function patchesRoutes({
  projectStore,
  patchManagerForProject,
  logger
}: Deps): Hono {
  const router = new Hono();

  router.post("/patches/check", async (c) => {
    const loaded = await loadPatchRequest(c.req.json(), projectStore);
    if (!("request" in loaded)) return loaded.response;
    try {
      const result = await patchManagerForProject(loaded.project.summary.rootPath).check({
        projectRoot: loaded.project.summary.rootPath,
        patch: loaded.request.patch
      });
      return c.json(PatchCheckResponseSchema.parse(result));
    } catch (error) {
      return handlePatchError(c, error, loaded.request.projectId, logger);
    }
  });

  router.post("/patches/apply-temporary", async (c) => {
    const loaded = await loadPatchRequest(c.req.json(), projectStore);
    if (!("request" in loaded)) return loaded.response;
    try {
      const result = await patchManagerForProject(loaded.project.summary.rootPath).applyTemporary({
        projectRoot: loaded.project.summary.rootPath,
        patch: loaded.request.patch
      });
      if (!result.applied) {
        return apiError(
          c,
          "PATCH_APPLY_FAILED",
          result.diagnostics,
          409
        );
      }
      return c.json(PatchApplyResponseSchema.parse(result));
    } catch (error) {
      return handlePatchError(c, error, loaded.request.projectId, logger);
    }
  });

  router.post("/patches/revert-temporary", async (c) => {
    const loaded = await loadPatchRequest(c.req.json(), projectStore);
    if (!("request" in loaded)) return loaded.response;
    try {
      const result = await patchManagerForProject(loaded.project.summary.rootPath).revertTemporary({
        projectRoot: loaded.project.summary.rootPath,
        patch: loaded.request.patch
      });
      if (!result.reverted) {
        return apiError(
          c,
          "PATCH_REVERT_FAILED",
          result.diagnostics,
          409
        );
      }
      return c.json(PatchRevertResponseSchema.parse(result));
    } catch (error) {
      return handlePatchError(c, error, loaded.request.projectId, logger);
    }
  });

  return router;
}

async function loadPatchRequest(
  bodyPromise: Promise<unknown>,
  projectStore: ProjectStore
): Promise<
  | {
      request: PatchRequest;
      project: CurrentProject;
    }
  | { response: Response }
> {
  const body = await bodyPromise.catch(() => ({}));
  const parsed = PatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      response: new Response(
        JSON.stringify({
          error: {
            code: "INVALID_INPUT",
            message: parsed.error.issues.map((i) => i.message).join("; ")
          }
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    };
  }
  const current = projectStore.getById(parsed.data.projectId);
  if (!current) {
    return {
      response: new Response(
        JSON.stringify({
          error: { code: "NO_PROJECT", message: "Project is not open." }
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      )
    };
  }
  return { request: parsed.data, project: current };
}

function handlePatchError(
  c: Parameters<typeof apiError>[0],
  error: unknown,
  projectId: string,
  logger?: RunManagerLogger
): Response {
  logger?.error(
    {
      projectIdHash: projectIdHash(projectId),
      artifactKind: "patch",
      ...errorLogFields(error)
    },
    "patch operation failed"
  );
  if (error instanceof PatchValidationError) {
    return apiError(c, "PATCH_INVALID", error.message, 400);
  }
  if (error instanceof CommandPolicyError) {
    return apiError(c, "PATCH_COMMAND_REJECTED", "Git command was rejected.", 400);
  }
  return apiError(c, "PATCH_OPERATION_FAILED", "Patch operation failed.", 500);
}
