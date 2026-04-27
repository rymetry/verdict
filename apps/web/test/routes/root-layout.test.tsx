// __root (RootLayout) の統合テスト。
// QueryClientProvider + RouterProvider 配下で render し、以下を role / DOM 観察ベースで pin する:
//  - rerun / activeRun の banner ライフサイクル (出現・dismiss・再 mount)
//  - RunControls form submit の error surface と入力編集による解除
//  - lastRequest=null invariant の UI 層防衛 (canRerun guard が disabled で守る)
//  - Error 階層 (WorkbenchApiError extends Error) の narrow 維持
//  - `r` キーボードショートカット (input 上ではトリガしない)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import type { ProjectSummary } from "@pwqa/shared";

import { WorkbenchApiError } from "@/api/client";
import { createInitialRunState, useRunStore } from "@/store/run-store";
import { renderWithRouter } from "../_helpers/render-with-router";
import { makeRunMetadata, makeRunRequest } from "../_fixtures/run";

// ネットワーク呼び出しを抑止し、各 fetch を vi.mocked で個別操作する。
// `vi.importActual` で `WorkbenchApiError` 等の class を保つ (`instanceof` を test/production で揃える)。
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

// `as ProjectSummary` cast を避け、戻り型を明示することで TS が必須 field を強制する。
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

describe("RootLayout integration (route /qa)", () => {
  it("初期描画で TopBar / StatusBar が出る (project 未オープン状態)", async () => {
    renderWithRouter();
    expect(await screen.findByRole("banner", { name: "Workbench top bar" })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: "セッションステータス" })).toBeInTheDocument();
  });

  it("rerun mutation がエラーになると ShellAlert が role=alert で `code: message` 形式で出る", async () => {
    useRunStore.setState({
      activeRunId: null,
      lastRequest: makeRunRequest()
    });
    vi.mocked(startRun).mockRejectedValue(
      new WorkbenchApiError("Run blocked", "RUN_BLOCKED", 409)
    );
    const { user } = renderWithRouter();

    await user.click(await screen.findByRole("button", { name: /再実行/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/RUN_BLOCKED/);
    expect(alert).toHaveTextContent(/Run blocked/);
  });

  it("ShellAlert の dismiss で mutation.reset() 経由 banner が消える", async () => {
    useRunStore.setState({
      activeRunId: null,
      lastRequest: makeRunRequest()
    });
    vi.mocked(startRun).mockRejectedValue(new Error("network"));
    const { user } = renderWithRouter();

    await user.click(await screen.findByRole("button", { name: /再実行/ }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "通知を閉じる" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("失敗回数が変わると banner が **再 mount** される (key={failureCount} で role=alert を再 announce)", async () => {
    useRunStore.setState({
      activeRunId: null,
      lastRequest: makeRunRequest()
    });
    vi.mocked(startRun).mockRejectedValue(new Error("boom"));
    const { user } = renderWithRouter();

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

  it("activeRunQuery error の dismiss で activeRunId が null になり banner が消える (clearActive + removeQueries 二段)", async () => {
    useRunStore.setState({
      activeRunId: "abc-123",
      lastRequest: makeRunRequest()
    });
    vi.mocked(fetchRun).mockRejectedValue(new Error("boom"));
    const { user } = renderWithRouter();

    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "通知を閉じる" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(useRunStore.getState().activeRunId).toBeNull();
    expect(useRunStore.getState().lastRequest).not.toBeNull();
  });

  it("RunControls の入力編集で前回 error が解除される (UX dead-end 回避)", async () => {
    vi.mocked(fetchCurrentProject).mockResolvedValue(makeProject());
    vi.mocked(startRun).mockRejectedValue(
      new WorkbenchApiError("Bad spec", "VALIDATION", 400)
    );
    const { user } = renderWithRouter();

    const submit = await screen.findByRole("button", { name: /Run Playwright/i });
    await user.click(submit);
    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      expect(alerts.some((el) => /VALIDATION: Bad spec/.test(el.textContent ?? ""))).toBe(true);
    });

    const specInput = screen.getByPlaceholderText(/auth\.spec\.ts/);
    await user.type(specInput, "fix");
    await waitFor(() => {
      const alerts = screen.queryAllByRole("alert");
      expect(alerts.some((el) => /VALIDATION/.test(el.textContent ?? ""))).toBe(false);
    });
  });

  it("lastRequest=null 時は canRerun guard により button が disabled で click が console.error 経路に到達しない", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    useRunStore.setState({ activeRunId: null, lastRequest: null });
    renderWithRouter();
    const btn = await screen.findByRole("button", { name: /再実行/ });
    expect(btn).toBeDisabled();
    btn.click();
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("RerunButton.onRerun")
    );
    errorSpy.mockRestore();
  });

  it("activeRunQuery エラー時に banner を出す (Error.message が優先される / fallback 文字列ではない)", async () => {
    useRunStore.setState({
      activeRunId: "abc-123",
      lastRequest: makeRunRequest()
    });
    vi.mocked(fetchRun).mockRejectedValue(new Error("boom"));
    renderWithRouter();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/boom/);
    expect(alert).not.toHaveTextContent(/Run #abc-123/);
  });

  it("RunControls の form submit エラーが errorBlock に role=alert で出る (silent failure 防衛)", async () => {
    vi.mocked(fetchCurrentProject).mockResolvedValue(makeProject());
    vi.mocked(startRun).mockRejectedValue(
      new WorkbenchApiError("Bad spec", "VALIDATION", 400)
    );
    const { user } = renderWithRouter();

    const submit = await screen.findByRole("button", { name: /Run Playwright/i });
    await user.click(submit);

    await waitFor(() => {
      const alerts = screen.getAllByRole("alert");
      const matched = alerts.find((el) => /VALIDATION: Bad spec/.test(el.textContent ?? ""));
      expect(matched).toBeTruthy();
    });
  });

  it("rerun mutation の error は WorkbenchApiError (Error 子クラス) として narrow 可能", async () => {
    useRunStore.setState({
      activeRunId: null,
      lastRequest: makeRunRequest()
    });
    vi.mocked(startRun).mockRejectedValue(
      new WorkbenchApiError("blocked", "RUN_BLOCKED", 409)
    );
    const { user } = renderWithRouter();

    await user.click(await screen.findByRole("button", { name: /再実行/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/RUN_BLOCKED/);
  });
});

describe("`r` キーボードショートカット", () => {
  it("input 外で `r` を押すと rerun が発火する (canRerun=true 前提)", async () => {
    useRunStore.setState({
      activeRunId: null,
      lastRequest: makeRunRequest({ projectId: "p-keyboard" })
    });
    vi.mocked(startRun).mockResolvedValue({
      runId: "run-from-r",
      metadata: makeRunMetadata("run-from-r", { status: "queued" })
    });
    renderWithRouter();

    // shell が描画されたことを確認 (= useEffect の listener 装着完了の signal)
    await screen.findByRole("button", { name: /再実行/ });

    // user.keyboard は active element に依存して dispatch するため、focus 不在時の挙動が不安定。
    // window 上のリスナーを直接叩いて bubbling を確実に再現する。
    fireEvent.keyDown(window, { key: "r" });

    await waitFor(() => {
      expect(vi.mocked(startRun)).toHaveBeenCalledTimes(1);
    });
    // mutationFn は (variables, context) の 2 引数で呼ばれる。第 1 引数だけ pin する。
    expect(vi.mocked(startRun).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ projectId: "p-keyboard" })
    );
  });

  it("canRerun=false (lastRequest=null) のときは `r` を押してもトリガしない", async () => {
    useRunStore.setState({ activeRunId: null, lastRequest: null });
    renderWithRouter();

    await screen.findByRole("button", { name: /再実行/ });
    fireEvent.keyDown(window, { key: "r" });

    expect(vi.mocked(startRun)).not.toHaveBeenCalled();
  });

  it("input にフォーカスしているときは `r` 入力でトリガしない (タイピング干渉防止)", async () => {
    vi.mocked(fetchCurrentProject).mockResolvedValue(makeProject());
    useRunStore.setState({
      activeRunId: null,
      lastRequest: makeRunRequest({ projectId: "p-typing" })
    });
    renderWithRouter();

    const specInput = (await screen.findByPlaceholderText(/auth\.spec\.ts/)) as HTMLInputElement;
    specInput.focus();
    // input 上での keydown は shouldIgnoreShortcut で弾かれる契約
    fireEvent.keyDown(specInput, { key: "r" });

    expect(vi.mocked(startRun)).not.toHaveBeenCalled();
  });

  it("修飾キー (Cmd/Ctrl) との組み合わせは無視される (ブラウザ標準動作を阻害しない)", async () => {
    useRunStore.setState({
      activeRunId: null,
      lastRequest: makeRunRequest()
    });
    renderWithRouter();
    await screen.findByRole("button", { name: /再実行/ });

    fireEvent.keyDown(window, { key: "r", metaKey: true });
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });

    expect(vi.mocked(startRun)).not.toHaveBeenCalled();
  });

  it("`R` (大文字) でも発火する (Shift 経由 / CapsLock 想定)", async () => {
    useRunStore.setState({
      activeRunId: null,
      lastRequest: makeRunRequest({ projectId: "p-uppercase" })
    });
    vi.mocked(startRun).mockResolvedValue({
      runId: "from-uppercase",
      metadata: makeRunMetadata("from-uppercase", { status: "queued" })
    });
    renderWithRouter();
    await screen.findByRole("button", { name: /再実行/ });

    fireEvent.keyDown(window, { key: "R" });

    await waitFor(() => {
      expect(vi.mocked(startRun)).toHaveBeenCalledTimes(1);
    });
  });

  it("active run が running 状態のとき `r` を押しても rerun は走らない (multi-trigger 防止)", async () => {
    useRunStore.setState({
      activeRunId: "run-running",
      lastRequest: makeRunRequest({ projectId: "p-running" })
    });
    // active run は running 中。RerunButton のラベルは "実行中…" に切替わる。
    // accessible name は visible text から導出されるため、`/実行中/` で wait する。
    vi.mocked(fetchRun).mockResolvedValue(makeRunMetadata("run-running", { status: "running" }));
    renderWithRouter();

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /実行中/ });
      expect(btn).toBeDisabled();
    });

    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "r" });

    // canRerun=false なので mutate は呼ばれない (= startRun 呼出なし)
    expect(vi.mocked(startRun)).not.toHaveBeenCalled();
  });

  it("rerun mutation が pending 中に `r` 連打しても 1 回しか発火しない (closure race 防止)", async () => {
    useRunStore.setState({
      activeRunId: null,
      lastRequest: makeRunRequest({ projectId: "p-pending" })
    });
    // never-resolve で永続 pending を作る
    vi.mocked(startRun).mockReturnValue(new Promise<never>(() => {}));
    renderWithRouter();
    await screen.findByRole("button", { name: /再実行/ });

    // 1 回目: 発火する
    fireEvent.keyDown(window, { key: "r" });
    await waitFor(() => {
      expect(vi.mocked(startRun)).toHaveBeenCalledTimes(1);
    });

    // 2 回目: isPending=true で canRerun=false → 発火しない
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "r" });

    // 短い waitFor で pending 状態が反映されたことを確認 (race を見落とさないため)
    await waitFor(() => {
      expect(vi.mocked(startRun)).toHaveBeenCalledTimes(1);
    });
  });
});
