// App コンポーネントの統合テスト。
// app-shell ロジック (rerun banner / activeRun query / RunControls form submit / lastRequest
// invariant 防衛) を QueryClientProvider 配下で render して、role / DOM 観察ベースで pin する。
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
// `vi.importActual` で `WorkbenchApiError` 等の class を保つ (`instanceof` を test/production で揃える)。
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

// WebSocket 接続は本テストの対象外 (production の status 更新経路は bypass している)。
// 自然消去シナリオは E2E 層で別途検証する想定。
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
      runDir: "/runs/test",
      metadataJson: "/runs/test/metadata.json",
      stdoutLog: "/runs/test/stdout.log",
      stderrLog: "/runs/test/stderr.log",
      playwrightJson: "/runs/test/playwright.json",
      playwrightHtml: "/runs/test/playwright-report",
      artifactsJson: "/runs/test/artifacts.json"
    },
    warnings: []
  };
}

function makeProject(overrides: Partial<import("@pwqa/shared").ProjectSummary> = {}) {
  return {
    id: "p1",
    rootPath: "/Users/example/projects/acme",
    packageJsonPath: "/Users/example/projects/acme/package.json",
    playwrightConfigPath: undefined,
    packageManager: {
      name: "pnpm",
      status: "ok",
      confidence: "high",
      reason: "fixture",
      warnings: [],
      errors: [],
      lockfiles: ["pnpm-lock.yaml"],
      packageManagerField: undefined,
      override: undefined,
      commandTemplates: {
        playwrightTest: { executable: "pnpm", args: ["exec", "playwright", "test"] }
      },
      hasPlaywrightDevDependency: true,
      localBinaryUsable: true,
      blockingExecution: false
    },
    hasAllurePlaywright: false,
    hasAllureCli: false,
    warnings: [],
    blockingExecution: false,
    ...overrides
  } as import("@pwqa/shared").ProjectSummary;
}

function renderApp(): { user: ReturnType<typeof userEvent.setup> } {
  // refetchInterval も止めて test の noise / flake を抑える
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
      mutations: { retry: false }
    }
  });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  useRunStore.setState(createInitialRunState(), false);
  vi.mocked(fetchHealth).mockReset();
  vi.mocked(fetchCurrentProject).mockReset();
  vi.mocked(fetchRun).mockReset();
  vi.mocked(startRun).mockReset();
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

  it("rerun mutation がエラーになると ShellAlert が role=alert で `code: message` 形式で出る", async () => {
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

  it("失敗回数が変わると banner が **再 mount** される (key={failureCount} で role=alert を再 announce)", async () => {
    useRunStore.setState({
      activeRunId: null,
      lastRequest: { projectId: "p1", headed: false } as RunRequest
    });
    // 同一 message で 2 回 reject させる
    vi.mocked(startRun).mockRejectedValue(new Error("boom"));
    const { user } = renderApp();

    await user.click(await screen.findByRole("button", { name: /再実行/ }));
    const firstAlert = await screen.findByRole("alert");

    // dismiss でリセット → 再度 mutate
    await user.click(screen.getByRole("button", { name: "通知を閉じる" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /再実行/ }));
    const secondAlert = await screen.findByRole("alert");

    // failureCount 増加で key 切替 → DOM 再 mount を pin
    expect(secondAlert).not.toBe(firstAlert);
  });

  it("activeRunQuery エラー時に banner を出す (Error.message が優先される / fallback 文字列ではない)", async () => {
    useRunStore.setState({
      activeRunId: "abc-123",
      lastRequest: { projectId: "p1", headed: false } as RunRequest
    });
    vi.mocked(fetchRun).mockRejectedValue(new Error("boom"));
    renderApp();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/boom/);
    // formatMutationError は Error.message を優先するため、fallback テンプレートは出ない
    expect(alert).not.toHaveTextContent(/Run #abc-123/);
  });

  it("activeRunQuery error の banner は dismiss (refetch) で消せる (UX dead-end 回避)", async () => {
    useRunStore.setState({
      activeRunId: "abc-123",
      lastRequest: { projectId: "p1", headed: false } as RunRequest
    });
    // 1 回目 reject、その後成功で fetch を確定させる
    vi.mocked(fetchRun)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(makeRunMetadata("abc-123"));
    const { user } = renderApp();

    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "通知を閉じる" }));

    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    );
  });

  it("RunControls の form submit エラーが errorBlock に role=alert で出る (silent failure 防衛)", async () => {
    vi.mocked(fetchCurrentProject).mockResolvedValue(makeProject());
    vi.mocked(startRun).mockRejectedValue(
      new WorkbenchApiError("Bad spec", "VALIDATION", 400)
    );
    const { user } = renderApp();

    // project が読み込まれて Run controls フォームが描画されるのを待つ
    const submit = await screen.findByRole("button", { name: /Run Playwright/i });
    await user.click(submit);

    // role=alert は複数出る可能性があるので getAllByRole で取得し、VALIDATION を含むものを確認
    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      const matched = alerts.find((el) => /VALIDATION: Bad spec/.test(el.textContent ?? ""));
      expect(matched).toBeTruthy();
    });
  });

  it("rerun mutation の error は WorkbenchApiError (Error 子クラス) として narrow 可能", async () => {
    useRunStore.setState({
      activeRunId: null,
      lastRequest: { projectId: "p1", headed: false } as RunRequest
    });
    vi.mocked(startRun).mockRejectedValue(
      new WorkbenchApiError("blocked", "RUN_BLOCKED", 409)
    );
    const { user } = renderApp();

    await user.click(await screen.findByRole("button", { name: /再実行/ }));
    const alert = await screen.findByRole("alert");
    // production と test で同じ class 参照であることを subtree 文字列 で間接的に pin
    // (production と vi.mock の `actual` spread が破綻すると instanceof が false になる)
    expect(alert).toHaveTextContent(/RUN_BLOCKED/);
  });
});
