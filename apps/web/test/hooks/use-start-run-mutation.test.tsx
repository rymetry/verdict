// useStartRunMutation の onSuccess 経路を検証する。
// - startRun が解決したら useRunStore.startTracking が呼ばれること
// - queryClient.invalidateQueries が ["runs"] queryKey で呼ばれること
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import * as React from "react";
import type { RunMetadata, RunRequest } from "@pwqa/shared";

import { useStartRunMutation } from "@/hooks/use-start-run-mutation";
import { createInitialRunState, useRunStore } from "@/store/run-store";

// fetch ベースの startRun を直接モックする (network を出さない)
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    startRun: vi.fn()
  };
});

import { startRun } from "@/api/client";

function makeMetadata(runId: string): RunMetadata {
  return {
    runId,
    projectId: "p1",
    projectRoot: "/p",
    status: "queued",
    startedAt: "2026-04-28T00:00:00Z",
    command: { executable: "npx", args: ["playwright", "test"] },
    cwd: "/p",
    requested: { projectId: "p1", headed: false } as RunRequest,
    paths: {
      runDir: "",
      metadataJson: "",
      stdoutLog: "",
      stderrLog: "",
      playwrightJson: "",
      playwrightHtml: "",
      artifactsJson: ""
    },
    warnings: []
  };
}

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }): React.ReactElement {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useStartRunMutation", () => {
  beforeEach(() => {
    useRunStore.setState(createInitialRunState(), false);
    vi.mocked(startRun).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("成功時に startTracking が呼ばれて activeRunId が更新される", async () => {
    vi.mocked(startRun).mockResolvedValue({ runId: "r1", metadata: makeMetadata("r1") });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useStartRunMutation(), { wrapper: wrapper(client) });

    const request: RunRequest = { projectId: "p1", headed: false };
    result.current.mutate(request);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useRunStore.getState().activeRunId).toBe("r1");
    expect(useRunStore.getState().lastRequest).toEqual(request);
  });

  it("成功時に ['runs'] queryKey の invalidate が呼ばれる", async () => {
    vi.mocked(startRun).mockResolvedValue({ runId: "r2", metadata: makeMetadata("r2") });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useStartRunMutation(), { wrapper: wrapper(client) });
    result.current.mutate({ projectId: "p1", headed: false });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["runs"] });
  });

  it("startRun が reject した場合 mutation は error を保持する", async () => {
    vi.mocked(startRun).mockRejectedValue(new Error("upstream 503"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useStartRunMutation(), { wrapper: wrapper(client) });
    result.current.mutate({ projectId: "p1", headed: false });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("upstream 503");
    // 失敗時は activeRunId / lastRequest を更新しない
    expect(useRunStore.getState().activeRunId).toBeNull();
  });
});
