// RunControls の振る舞い: 未 project / blocked / submit / error 表示 / clear-on-edit。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectSummary } from "@pwqa/shared";

import { RunControls } from "@/features/run-controls/RunControls";
import { createInitialRunState, useRunStore } from "@/store/run-store";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, startRun: vi.fn() };
});
import { startRun } from "@/api/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeProject(over: Partial<ProjectSummary> = {}): ProjectSummary {
  const base: ProjectSummary = {
    id: "p1",
    rootPath: "/p",
    packageJsonPath: "/p/package.json",
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
  return { ...base, ...over };
}

function renderControls(project: ProjectSummary | null): {
  user: ReturnType<typeof userEvent.setup>;
} {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RunControls project={project} />
    </QueryClientProvider>
  );
  return { user: userEvent.setup() };
}

beforeEach(() => {
  useRunStore.setState(createInitialRunState(), false);
  vi.mocked(startRun).mockReset();
});

describe("RunControls", () => {
  it("project=null のとき controls は disabled な案内文に置き換わる", () => {
    renderControls(null);
    expect(screen.getByText(/プロジェクトを開くと実行できます/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run Playwright/ })).not.toBeInTheDocument();
  });

  it("blocked プロジェクトでは button は disabled で警告 alert が出る", () => {
    renderControls(makeProject({ blockingExecution: true }));
    const button = screen.getByRole("button", { name: /Run Playwright/ });
    expect(button).toBeDisabled();
    expect(screen.getByText(/実行ブロック中/)).toBeInTheDocument();
  });

  it("submit 時に startRun が trim 後の値で呼ばれる (空 string は undefined になる)", async () => {
    vi.mocked(startRun).mockResolvedValue({
      runId: "r1",
      metadata: {
        runId: "r1",
        projectId: "p1",
        projectRoot: "/p",
        status: "queued",
        startedAt: "2026-04-28T00:00:00Z",
        command: { executable: "pnpm", args: [] },
        cwd: "/p",
        requested: { projectId: "p1", headed: false },
        paths: {
          runDir: "/runs/r1",
          metadataJson: "/runs/r1/metadata.json",
          stdoutLog: "/runs/r1/stdout.log",
          stderrLog: "/runs/r1/stderr.log",
          playwrightJson: "/runs/r1/playwright.json",
          playwrightHtml: "/runs/r1/playwright-report",
          artifactsJson: "/runs/r1/artifacts.json",
          allureResultsDest: "/runs/r1/allure-results",
          allureReportDir: "/runs/r1/allure-report",
          qualityGateResultPath: "/runs/r1/quality-gate-result.json",
          allureExportsDir: "/runs/r1/allure-exports",
          allureCsvPath: "/runs/r1/allure-exports/results.csv",
          allureLogPath: "/runs/r1/allure-exports/results.log",
          qmoSummaryJsonPath: "/runs/r1/qmo-summary.json",
          qmoSummaryMarkdownPath: "/runs/r1/qmo-summary.md"
        },
        warnings: []
      }
    });
    const { user } = renderControls(makeProject());
    await user.type(screen.getByLabelText(/Spec path/), "  tests/a.spec.ts  ");
    await user.click(screen.getByRole("button", { name: /Run Playwright/ }));
    await waitFor(() => {
      expect(vi.mocked(startRun)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(startRun).mock.calls[0]?.[0]).toEqual({
      projectId: "p1",
      specPath: "tests/a.spec.ts",
      grep: undefined,
      headed: false
    });
  });

  it("error 時は 'Failed to start run' (or message) を Alert に出す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(startRun).mockRejectedValue(new Error("net down"));
    const { user } = renderControls(makeProject());
    await user.click(screen.getByRole("button", { name: /Run Playwright/ }));
    expect(await screen.findByText("起動失敗")).toBeInTheDocument();
    expect(screen.getByText("net down")).toBeInTheDocument();
  });

  it("入力編集で前回 error は reset される", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(startRun).mockRejectedValueOnce(new Error("first"));
    const { user } = renderControls(makeProject());
    await user.click(screen.getByRole("button", { name: /Run Playwright/ }));
    expect(await screen.findByText("first")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Spec path/), "x");
    await waitFor(() => {
      expect(screen.queryByText("first")).not.toBeInTheDocument();
    });
  });

  it("Quality Gate profile はデフォルトが local-review、選択した値が request に乗る", async () => {
    vi.mocked(startRun).mockResolvedValue({
      runId: "r2",
      metadata: {
        runId: "r2",
        projectId: "p1",
        projectRoot: "/p",
        status: "queued",
        startedAt: "2026-04-30T00:00:00Z",
        command: { executable: "pnpm", args: [] },
        cwd: "/p",
        requested: { projectId: "p1", headed: false },
        paths: {
          runDir: "/runs/r2",
          metadataJson: "/runs/r2/metadata.json",
          stdoutLog: "/runs/r2/stdout.log",
          stderrLog: "/runs/r2/stderr.log",
          playwrightJson: "/runs/r2/playwright.json",
          playwrightHtml: "/runs/r2/playwright-report",
          artifactsJson: "/runs/r2/artifacts.json",
          allureResultsDest: "/runs/r2/allure-results",
          allureReportDir: "/runs/r2/allure-report",
          qualityGateResultPath: "/runs/r2/quality-gate-result.json",
          allureExportsDir: "/runs/r2/allure-exports",
          allureCsvPath: "/runs/r2/allure-exports/results.csv",
          allureLogPath: "/runs/r2/allure-exports/results.log",
          qmoSummaryJsonPath: "/runs/r2/qmo-summary.json",
          qmoSummaryMarkdownPath: "/runs/r2/qmo-summary.md"
        },
        warnings: []
      }
    });
    const { user } = renderControls(makeProject());
    const select = screen.getByTestId("run-controls-quality-gate-profile") as HTMLSelectElement;
    expect(select.value).toBe("local-review");
    await user.selectOptions(select, "release-smoke");
    await user.click(screen.getByRole("button", { name: /Run Playwright/ }));
    await waitFor(() => {
      expect(vi.mocked(startRun)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(startRun).mock.calls[0]?.[0]).toMatchObject({
      qualityGateProfile: "release-smoke"
    });
  });

  it("project/headed/retries/workers controls を request に反映する", async () => {
    vi.mocked(startRun).mockResolvedValue({
      runId: "r-controls",
      metadata: {
        runId: "r-controls",
        projectId: "p1",
        projectRoot: "/p",
        status: "queued",
        startedAt: "2026-04-30T00:00:00Z",
        command: { executable: "pnpm", args: [] },
        cwd: "/p",
        requested: {
          projectId: "p1",
          headed: true,
          projectNames: ["chromium", "webkit"],
          retries: 2,
          workers: 4
        },
        paths: {
          runDir: "/runs/r-controls",
          metadataJson: "/runs/r-controls/metadata.json",
          stdoutLog: "/runs/r-controls/stdout.log",
          stderrLog: "/runs/r-controls/stderr.log",
          playwrightJson: "/runs/r-controls/playwright.json",
          playwrightHtml: "/runs/r-controls/playwright-report",
          artifactsJson: "/runs/r-controls/artifacts.json",
          allureResultsDest: "/runs/r-controls/allure-results",
          allureReportDir: "/runs/r-controls/allure-report",
          qualityGateResultPath: "/runs/r-controls/quality-gate-result.json",
          allureExportsDir: "/runs/r-controls/allure-exports",
          allureCsvPath: "/runs/r-controls/allure-exports/results.csv",
          allureLogPath: "/runs/r-controls/allure-exports/results.log",
          qmoSummaryJsonPath: "/runs/r-controls/qmo-summary.json",
          qmoSummaryMarkdownPath: "/runs/r-controls/qmo-summary.md"
        },
        warnings: []
      }
    });
    const { user } = renderControls(makeProject());
    await user.type(
      screen.getByLabelText(/Project names/),
      " chromium, webkit "
    );
    await user.click(screen.getByLabelText("Headed"));
    await user.type(screen.getByLabelText("Retries"), "2");
    await user.type(screen.getByLabelText("Workers"), "4");
    await user.click(screen.getByRole("button", { name: /Run Playwright/ }));
    await waitFor(() => {
      expect(vi.mocked(startRun)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(startRun).mock.calls[0]?.[0]).toMatchObject({
      projectNames: ["chromium", "webkit"],
      headed: true,
      retries: 2,
      workers: 4
    });
  });

  it("local-review が選ばれた状態では qualityGateProfile は request に含めない (default == omit)", async () => {
    vi.mocked(startRun).mockResolvedValue({
      runId: "r3",
      metadata: {
        runId: "r3",
        projectId: "p1",
        projectRoot: "/p",
        status: "queued",
        startedAt: "2026-04-30T00:00:00Z",
        command: { executable: "pnpm", args: [] },
        cwd: "/p",
        requested: { projectId: "p1", headed: false },
        paths: {
          runDir: "/runs/r3",
          metadataJson: "/runs/r3/metadata.json",
          stdoutLog: "/runs/r3/stdout.log",
          stderrLog: "/runs/r3/stderr.log",
          playwrightJson: "/runs/r3/playwright.json",
          playwrightHtml: "/runs/r3/playwright-report",
          artifactsJson: "/runs/r3/artifacts.json",
          allureResultsDest: "/runs/r3/allure-results",
          allureReportDir: "/runs/r3/allure-report",
          qualityGateResultPath: "/runs/r3/quality-gate-result.json",
          allureExportsDir: "/runs/r3/allure-exports",
          allureCsvPath: "/runs/r3/allure-exports/results.csv",
          allureLogPath: "/runs/r3/allure-exports/results.log",
          qmoSummaryJsonPath: "/runs/r3/qmo-summary.json",
          qmoSummaryMarkdownPath: "/runs/r3/qmo-summary.md"
        },
        warnings: []
      }
    });
    const { user } = renderControls(makeProject());
    await user.click(screen.getByRole("button", { name: /Run Playwright/ }));
    await waitFor(() => {
      expect(vi.mocked(startRun)).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(startRun).mock.calls[0]?.[0]?.qualityGateProfile).toBeUndefined();
  });

  it("pending 中の連続 click は startRun を 1 回しか呼ばない (multi-run 防止)", async () => {
    // never-resolve Promise で submit を pending 状態に固定し、button disabled が
    // mutate の重複呼び出しを実際に防ぐことを pin (`disabled={... || isPending}` の有効性)。
    vi.mocked(startRun).mockReturnValue(new Promise(() => {}));
    const { user } = renderControls(makeProject());
    const button = screen.getByRole("button", { name: /Run Playwright/ });
    await user.click(button);
    await user.click(button);
    await user.click(button);
    expect(vi.mocked(startRun)).toHaveBeenCalledTimes(1);
  });
});
