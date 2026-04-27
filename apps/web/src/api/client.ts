import {
  HealthResponseSchema,
  ProjectSummarySchema,
  RunListResponseSchema,
  RunMetadataSchema,
  TestInventorySchema,
  type ApiError,
  type HealthResponse,
  type ProjectSummary,
  type RunListResponse,
  type RunMetadata,
  type RunRequest,
  type TestInventory
} from "@pwqa/shared";

const BASE = "/api";

export class WorkbenchApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "WorkbenchApiError";
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiError = body as ApiError;
    const message = apiError?.error?.message ?? `Request failed (${response.status})`;
    const code = apiError?.error?.code ?? "REQUEST_FAILED";
    throw new WorkbenchApiError(message, code, response.status);
  }
  return body as T;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch(`${BASE}/health`);
  const body = await parseJson<unknown>(response);
  return HealthResponseSchema.parse(body);
}

export async function openProject(rootPath: string): Promise<ProjectSummary> {
  const response = await fetch(`${BASE}/projects/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rootPath })
  });
  const body = await parseJson<unknown>(response);
  return ProjectSummarySchema.parse(body);
}

export async function fetchCurrentProject(): Promise<ProjectSummary | null> {
  const response = await fetch(`${BASE}/projects/current`);
  if (response.status === 404) return null;
  const body = await parseJson<unknown>(response);
  return ProjectSummarySchema.parse(body);
}

export async function fetchInventory(projectId: string): Promise<TestInventory> {
  const response = await fetch(
    `${BASE}/projects/${encodeURIComponent(projectId)}/inventory`
  );
  const body = await parseJson<unknown>(response);
  return TestInventorySchema.parse(body);
}

export async function startRun(request: RunRequest): Promise<{ runId: string; metadata: RunMetadata }> {
  const response = await fetch(`${BASE}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  const body = await parseJson<{ runId: string; metadata: unknown }>(response);
  return {
    runId: body.runId,
    metadata: RunMetadataSchema.parse(body.metadata)
  };
}

export async function fetchRuns(): Promise<RunListResponse> {
  const response = await fetch(`${BASE}/runs`);
  const body = await parseJson<unknown>(response);
  return RunListResponseSchema.parse(body);
}

export async function fetchRun(runId: string): Promise<RunMetadata> {
  const response = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}`);
  const body = await parseJson<unknown>(response);
  return RunMetadataSchema.parse(body);
}

export async function cancelRun(runId: string): Promise<void> {
  const response = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST"
  });
  await parseJson<unknown>(response);
}
