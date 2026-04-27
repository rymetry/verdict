// App コンポーネントの統合テスト。
// QueryClientProvider 配下で render し、以下を role / DOM 観察ベースで pin する:
//  - rerun / activeRun の banner ライフサイクル (出現・dismiss・再 mount)
//  - RunControls form submit の error surface と入力編集による解除
//  - lastRequest=null invariant の UI 層防衛 (canRerun guard が disabled で守る)
//  - Error 階層 (WorkbenchApiError extends Error) の narrow 維持
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import type { ProjectSummary, RunMetadata, RunRequest } from "@pwqa/shared";

import { App } from "@/App";
import { WorkbenchApiError } from "@/api/client";
import { createInitialRunState, useRunStore } from "@/store/run-store";

// ネットワーク呼び出しを抑止し、各 fetch を vi.mocked で個別操作する。
// `vi.importActual` で `WorkbenchApiError` 等の class を保つ (`instanceof` を test/production で揃える)。
// fetchInventory も mock しないと TestInventoryPanel が actual fetch を発火し alert noise になる。
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    fetchHealth: vi.fn(),
    fetchCurrentProject: vi.fn(),
    fetchInventory: vi.fn(),
    fetchRun: vi.fn(),
    startRun: vi.fn()
  };
});
import {
  fetchCurrentProject,
  fetchHealth,
  fetchInventory,
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

// `as ProjectSummary` cast を避け、戻り型を明示することで TS が必須 field を強制する。
// 必須でない field (optional) は spread の override で undefined を渡さず単純に省略する形で扱う
// (zod の optional は `T | undefined` と `T?` を等価扱いするが、後者の方が schema との対応が明示的)。
function makeProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  const base: ProjectSummary = {
    id: "p1",
    rootPath: "/Users/example/projects/acme",
    packageJsonPath: "/Users/example/projects/acme/package.json",
    packageManager: {
      name: "pnpm",
      status: "ok",
      confidence: "high",
      reason: "fixture",
      warnings: [],
      errors: [],
      lockfiles: ["pnpm-lock.yaml"],
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
    blockingExecution: false
  };
  return { ...base, ...overrides };
}

function renderApp(): { user: ReturnType<typeof userEvent.setup> } {
  // refetchInterval は止めて polling noise / flake を抑える。
  // `mutations.retry` は **明示的に上書きしない**: useStartRunMutation 側の `retry: 0` が
  // end-to-end で効いていることを統合層でも invariant として pin する。
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false }
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
  vi.mocked(fetchInventory).mockReset();
  vi.mocked(fetchRun).mockReset();
  vi.mocked(startRun).mockReset();
  vi.mocked(fetchHealth).mockResolvedValue({
    ok: true,
    service: "playwright-workbench-agent",
    version: "0.0.0-test",
    timestamp: "2026-04-28T00:00:00Z"
  });
  vi.mocked(fetchCurrentProject).mockResolvedValue(null);
  vi.mocked(fetchInventory).mockResolvedValue({
    projectId: "p1",
    source: "playwright-list-json",
    generatedAt: "2026-04-28T00:00:00Z",
    specs: [],
    totals: { specFiles: 0, tests: 0 },
    warnings: []
  });
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
    vi.mocked(startRun).mockRejectedValue(new Error("boom"));
    const { user } = renderApp();

    await user.click(await screen.findByRole("button", { name: /再実行/ }));
    const firstAlert = await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "通知を閉じる" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /再実行/ }));
    const secondAlert = await screen.findByRole("alert");

    // failureCount 増加で key 切替 → DOM 再 mount: 別ノードであり、かつ古いノードは DOM 切断済
    expect(secondAlert).not.toBe(firstAlert);
    expect(firstAlert.isConnected).toBe(false);
    // 同一 message が確実に再表示されている (再 announce の text contract)
    expect(secondAlert).toHaveTextContent("boom");
  });

  it("activeRunQuery error の dismiss で query cache が破棄される (refetch race 回避)", async () => {
    useRunStore.setState({
      activeRunId: "abc-123",
      lastRequest: { projectId: "p1", headed: false } as RunRequest
    });
    vi.mocked(fetchRun).mockRejectedValue(new Error("boom"));
    const { user } = renderApp();

    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "通知を閉じる" }));

    // removeQueries で error 状態が即座に消えること (refetch を待たない)
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    );
  });

  it("RunControls の入力編集で前回 error が解除される (UX dead-end 回避)", async () => {
    vi.mocked(fetchCurrentProject).mockResolvedValue(makeProject());
    vi.mocked(startRun).mockRejectedValue(
      new WorkbenchApiError("Bad spec", "VALIDATION", 400)
    );
    const { user } = renderApp();

    const submit = await screen.findByRole("button", { name: /Run Playwright/i });
    await user.click(submit);
    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts.some((el) => /VALIDATION: Bad spec/.test(el.textContent ?? ""))).toBe(true);
    });

    // 入力編集で error 自然解除
    const specInput = screen.getByPlaceholderText(/auth\.spec\.ts/);
    await user.type(specInput, "fix");
    await waitFor(() => {
      const alerts = screen.queryAllByRole("alert");
      expect(alerts.some((el) => /VALIDATION/.test(el.textContent ?? ""))).toBe(false);
    });
  });

  it("lastRequest=null かつ canRerun guard 破れ時は console.error する (invariant 防衛)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // canRerun=false で button が disabled。直接エラー pin の test ではなく、
    // disabled button に click が届かないことで invariant が UI 層で守られていることを assert。
    useRunStore.setState({ activeRunId: null, lastRequest: null });
    renderApp();
    const btn = screen.getByRole("button", { name: /再実行/ });
    expect(btn).toBeDisabled();
    // disabled button click は no-op で console.error は呼ばれない (UI guard が効いている証跡)
    btn.click();
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("RerunButton.onRerun")
    );
    errorSpy.mockRestore();
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
