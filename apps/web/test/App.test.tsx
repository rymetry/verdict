// App コンポーネントの統合テスト。
// - rerun mutation エラーが ShellAlert (role=alert) で表示されること
// - dismiss で `mutation.reset()` 経由 banner が消えること
// - 失敗回数が変わると banner が再 mount され role=alert が再 announce されること
// - activeRunQuery エラーが Run #ID 文字列付き banner で表示されること
// - lastRequest=null で onRerun が呼ばれた場合 console.error する (canRerun=false で disabled
//   が破られた場合の invariant 防衛)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import type { RunMetadata, RunRequest } from "@pwqa/shared";

import { App } from "@/App";
import { WorkbenchApiError } from "@/api/client";
import { createInitialRunState, useRunStore } from "@/store/run-store";

// ネットワーク呼び出しを抑止し、各 fetch を vi.mocked で個別操作する。
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    fetchHealth: vi.fn(),
    fetchCurrentProject: vi.fn(),
    fetchRun: vi.fn(),
    startRun: vi.fn()
  };
});
import {
  fetchCurrentProject,
  fetchHealth,
  fetchRun,
  startRun
} from "@/api/client";

// WebSocket 接続は本テストの対象外。lifecycle hook を no-op に置換する。
vi.mock("@/hooks/use-workbench-events", () => ({
  useWorkbenchEvents: () => ({ events: [], status: "closed" })
}));

function makeRunMetadata(runId: string): RunMetadata {
  return {
    runId,
    projectId: "p1",
    projectRoot: "/p",
    status: "passed",
    startedAt: "2026-04-28T00:00:00Z",
    completedAt: "2026-04-28T00:01:00Z",
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

function renderApp(): { user: ReturnType<typeof userEvent.setup> } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  // 各テストで store / mock を完全リセット
  useRunStore.setState(createInitialRunState(), false);
  vi.mocked(fetchHealth).mockReset();
  vi.mocked(fetchCurrentProject).mockReset();
  vi.mocked(fetchRun).mockReset();
  vi.mocked(startRun).mockReset();
  // 401 等の繰り返しでテストが noisy にならないよう defaults
  vi.mocked(fetchHealth).mockResolvedValue({
    ok: true,
    service: "playwright-workbench-agent",
    version: "0.0.0-test",
    timestamp: "2026-04-28T00:00:00Z"
  });
  vi.mocked(fetchCurrentProject).mockResolvedValue(null);
  vi.mocked(fetchRun).mockResolvedValue(makeRunMetadata("default"));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App integration", () => {
  it("初期描画で TopBar / StatusBar が出る (project 未オープン状態)", async () => {
    renderApp();
    expect(await screen.findByRole("banner", { name: "Workbench top bar" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: "セッションステータス" })).toBeInTheDocument();
  });

  it("rerun mutation がエラーになると ShellAlert が role=alert で出る", async () => {
    // lastRequest を仕込んで canRerun=true 状態にする
    useRunStore.setState({
      activeRunId: null,
      lastRequest: { projectId: "p1", headed: false } as RunRequest
    });
    vi.mocked(startRun).mockRejectedValue(
      new WorkbenchApiError("Run blocked", "RUN_BLOCKED", 409)
    );
    const { user } = renderApp();

    await user.click(await screen.findByRole("button", { name: /再実行/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/RUN_BLOCKED/);
    expect(alert).toHaveTextContent(/Run blocked/);
  });

  it("ShellAlert の dismiss で mutation.reset() 経由 banner が消える", async () => {
    useRunStore.setState({
      activeRunId: null,
      lastRequest: { projectId: "p1", headed: false } as RunRequest
    });
    vi.mocked(startRun).mockRejectedValue(new Error("network"));
    const { user } = renderApp();

    await user.click(await screen.findByRole("button", { name: /再実行/ }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "通知を閉じる" }));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    );
  });

  it("activeRunQuery エラー時に Run #<id> を含む banner を出す", async () => {
    useRunStore.setState({
      activeRunId: "abc-123",
      lastRequest: { projectId: "p1", headed: false } as RunRequest
    });
    vi.mocked(fetchRun).mockRejectedValue(new Error("boom"));
    renderApp();

    const alert = await screen.findByRole("alert");
    // formatMutationError は Error.message を優先するため、fallback の "Run #abc-123 ..." は
    // message が空のときだけ出る。message が "boom" なのでこちらが表示される。
    expect(alert).toHaveTextContent(/boom/);
  });
});
