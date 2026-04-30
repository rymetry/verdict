// useStartRunMutation の onSuccess 経路を検証する。
// - startRun が解決したら useRunStore.startTracking が呼ばれること
// - queryClient.invalidateQueries が ["runs"] queryKey で呼ばれること
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import * as React from "react";

import { useStartRunMutation } from "@/hooks/use-start-run-mutation";
import { createInitialRunState, useRunStore } from "@/store/run-store";
import { makeRunMetadata, makeRunRequest } from "../_fixtures/run";

// fetch ベースの startRun を直接モックする (network を出さない)
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    startRun: vi.fn()
  };
});

import { startRun } from "@/api/client";

// queued status の test 用 metadata (default は passed なので overrides で切替)
const makeQueuedMetadata = (runId: string) => makeRunMetadata(runId, { status: "queued" });

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
    vi.mocked(startRun).mockResolvedValue({ runId: "r1", metadata: makeQueuedMetadata("r1") });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useStartRunMutation(), { wrapper: wrapper(client) });

    const request = makeRunRequest();
    result.current.mutate(request);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(useRunStore.getState().activeRunId).toBe("r1");
    expect(useRunStore.getState().lastRequest).toEqual(request);
  });

  it("成功時に ['runs'] queryKey の invalidate が呼ばれる", async () => {
    vi.mocked(startRun).mockResolvedValue({ runId: "r2", metadata: makeQueuedMetadata("r2") });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useStartRunMutation(), { wrapper: wrapper(client) });
    result.current.mutate({ projectId: "p1", headed: false });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["runs"] });
  });

  it("成功時に run metadata を ['runs', runId] cache へ seed する", async () => {
    const metadata = makeQueuedMetadata("r-cache");
    vi.mocked(startRun).mockResolvedValue({ runId: "r-cache", metadata });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useStartRunMutation(), { wrapper: wrapper(client) });
    result.current.mutate(makeRunRequest());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData(["runs", "r-cache"])).toEqual(metadata);
  });

  it("成功時に ['runs', 'list'] cache へ新 run を先頭追加する", async () => {
    const metadata = makeQueuedMetadata("r-new");
    vi.mocked(startRun).mockResolvedValue({ runId: "r-new", metadata });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["runs", "list"], {
      runs: [
        makeRunMetadata("r-old", {
          status: "passed",
          startedAt: "2026-04-29T00:00:00.000Z"
        })
      ]
    });

    const { result } = renderHook(() => useStartRunMutation(), { wrapper: wrapper(client) });
    result.current.mutate(makeRunRequest());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryData<{ runs: Array<{ runId: string }> }>(["runs", "list"])?.runs.map((run) => run.runId)).toEqual([
      "r-new",
      "r-old"
    ]);
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

  it("WorkbenchApiError も Error として保持され instanceof で narrow 可能", async () => {
    const { WorkbenchApiError } = await import("@/api/client");
    vi.mocked(startRun).mockRejectedValue(
      new WorkbenchApiError("blocked", "RUN_BLOCKED", 409)
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useStartRunMutation(), { wrapper: wrapper(client) });
    result.current.mutate({ projectId: "p1", headed: false });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(WorkbenchApiError);
    expect((result.current.error as InstanceType<typeof WorkbenchApiError>).code).toBe(
      "RUN_BLOCKED"
    );
  });

  it("失敗時に console.error が呼ばれる (silent failure 防衛 / caller のサーフェス漏れ対策)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(startRun).mockRejectedValue(new Error("upstream 503"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useStartRunMutation(), { wrapper: wrapper(client) });

    const request = makeRunRequest({ projectId: "p-error-log" });
    result.current.mutate(request);
    await waitFor(() => expect(result.current.isError).toBe(true));

    // log の prefix と payload (RunRequest の主要 field) を pin する。
    // 詳細メッセージ内容まで pin すると brittle になるため "プレフィクス + projectId 含む" を確認するに留める。
    expect(errorSpy).toHaveBeenCalled();
    const firstCall = errorSpy.mock.calls[0];
    expect(firstCall?.[0]).toMatch(/useStartRunMutation/);
    expect(firstCall?.[1]).toEqual(
      expect.objectContaining({ projectId: "p-error-log", error: expect.any(Error) })
    );
    errorSpy.mockRestore();
  });

  it("retry は 0 (POST /runs は副作用的なので多重起動を防ぐ)", async () => {
    vi.mocked(startRun).mockRejectedValue(new Error("transient"));
    // QueryClient defaults で `mutations.retry: 3` を上書きしても、フックの `retry: 0` が
    // 個別指定として勝つこと (defense-in-depth invariant) を pin する。
    // この設定を入れずに test するとデフォルト (= 0) と区別がつかず regression を検出できない。
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: 3, retryDelay: 0 }
      }
    });

    const { result } = renderHook(() => useStartRunMutation(), { wrapper: wrapper(client) });
    result.current.mutate({ projectId: "p1", headed: false });
    await waitFor(() => expect(result.current.isError).toBe(true));

    // retry が走らないため startRun は 1 回だけ呼ばれる (フック側 retry: 0 の invariant)
    expect(vi.mocked(startRun)).toHaveBeenCalledTimes(1);
  });
});
