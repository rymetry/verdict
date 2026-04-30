import {
  AllureHistoryResponseSchema,
  HealthResponseSchema,
  ProjectSummarySchema,
  QmoSummarySchema,
  RunListResponseSchema,
  RunMetadataSchema,
  TestInventorySchema,
  type AllureHistoryResponse,
  type ApiError,
  type HealthResponse,
  type ProjectSummary,
  type QmoSummary,
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

/**
 * Phase 1.2 / T208-2: fetch the persisted QMO Release Readiness Summary
 * for a run. Returns `null` when the agent reports `409 NO_QMO_SUMMARY`
 * (file not yet generated — the dominant case during a run-in-progress
 * or for non-Allure projects). All other failure paths throw a
 * `WorkbenchApiError` so the UI's error boundary / toast can surface
 * them.
 */
export async function fetchQmoSummary(runId: string): Promise<QmoSummary | null> {
  const response = await fetch(`${BASE}/runs/${encodeURIComponent(runId)}/qmo-summary`);
  if (response.status === 409) return null;
  const body = await parseJson<unknown>(response);
  return QmoSummarySchema.parse(body);
}

/**
 * §1.3 fetch project-scoped Allure history JSONL entries (the cumulative
 * trend file the Allure CLI maintains under
 * `<projectRoot>/.playwright-workbench/reports/allure-history.jsonl`).
 * Returns `{ entries: [], warnings: [] }` when no history exists yet —
 * the dominant case before the first Allure-enabled run completes.
 */
export async function fetchAllureHistory(
  projectId: string
): Promise<AllureHistoryResponse> {
  const response = await fetch(
    `${BASE}/projects/${encodeURIComponent(projectId)}/allure-history`
  );
  const body = await parseJson<unknown>(response);
  return AllureHistoryResponseSchema.parse(body);
}
