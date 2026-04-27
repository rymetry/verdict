// ProjectPicker の振る舞いを pin する。
// - 未オープン状態で input + button が出る
// - submit で openProject が呼ばれ、成功時にプロジェクト要約が出る
// - WorkbenchApiError は code: message で表示される
// - 通常 Error は formatMutationError 経由で表示される
// - Blocked プロジェクトは "Blocked" バッジで表示される
// - Errors / Warnings 配列も表示される
// - 入力編集で前回 error が解除される (UI dead-end 防止)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectSummary } from "@pwqa/shared";

import { WorkbenchApiError } from "@/api/client";
import { ProjectPicker } from "@/features/project-picker/ProjectPicker";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, openProject: vi.fn(), fetchCurrentProject: vi.fn() };
});
import { fetchCurrentProject, openProject } from "@/api/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeProject(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  const base: ProjectSummary = {
    id: "p1",
    rootPath: "/Users/me/playwright-project",
    packageJsonPath: "/Users/me/playwright-project/package.json",
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

function renderWithQuery(): { user: ReturnType<typeof userEvent.setup>; client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <ProjectPicker />
    </QueryClientProvider>
  );
  return { user: userEvent.setup(), client };
}

beforeEach(() => {
  vi.mocked(fetchCurrentProject).mockResolvedValue(null);
  vi.mocked(openProject).mockReset();
});

describe("ProjectPicker", () => {
  it("プロジェクト未オープン時は input + Open ボタン + 案内文を出す", async () => {
    renderWithQuery();
    expect(
      await screen.findByLabelText("Absolute path to a Playwright project")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByText(/プロジェクト未オープン/)).toBeInTheDocument();
  });

  it("空入力で submit しても openProject は呼ばれない", async () => {
    const { user } = renderWithQuery();
    await user.click(await screen.findByRole("button", { name: "Open" }));
    expect(vi.mocked(openProject)).not.toHaveBeenCalled();
  });

  it("有効なパスで submit すると openProject が trim 後の値で呼ばれる", async () => {
    vi.mocked(openProject).mockResolvedValue(makeProject());
    const { user } = renderWithQuery();
    await user.type(
      await screen.findByLabelText("Absolute path to a Playwright project"),
      "  /tmp/p  "
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(vi.mocked(openProject)).toHaveBeenCalledWith("/tmp/p");
    });
  });

  it("成功時に Root / Package manager / Status (Ready) が出る", async () => {
    vi.mocked(openProject).mockResolvedValue(makeProject());
    const { user } = renderWithQuery();
    await user.type(
      await screen.findByLabelText("Absolute path to a Playwright project"),
      "/tmp/p"
    );
    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(await screen.findByText("/Users/me/playwright-project")).toBeInTheDocument();
    expect(screen.getByText("pnpm")).toBeInTheDocument();
    expect(screen.getByText(/\(high\)/)).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("blocking のとき Status は Blocked になる", async () => {
    vi.mocked(openProject).mockResolvedValue(makeProject({ blockingExecution: true }));
    const { user } = renderWithQuery();
    await user.type(
      await screen.findByLabelText("Absolute path to a Playwright project"),
      "/tmp/p"
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Blocked")).toBeInTheDocument();
  });

  it("Errors / Warnings 配列も列挙される", async () => {
    vi.mocked(openProject).mockResolvedValue(
      makeProject({
        packageManager: {
          ...makeProject().packageManager,
          errors: ["lock 不整合"],
          warnings: ["古い node"]
        }
      })
    );
    const { user } = renderWithQuery();
    await user.type(
      await screen.findByLabelText("Absolute path to a Playwright project"),
      "/tmp/p"
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("lock 不整合")).toBeInTheDocument();
    expect(screen.getByText("古い node")).toBeInTheDocument();
  });

  it("WorkbenchApiError は 'API エラー' タイトル + code: message で表示する", async () => {
    vi.mocked(openProject).mockRejectedValue(new WorkbenchApiError("dir not found", "E_NOT_DIR", 400));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderWithQuery();
    await user.type(
      await screen.findByLabelText("Absolute path to a Playwright project"),
      "/nope"
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("API エラー")).toBeInTheDocument();
    expect(screen.getByText("E_NOT_DIR: dir not found")).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("通常 Error は 'エラー' タイトル + message で表示する", async () => {
    vi.mocked(openProject).mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderWithQuery();
    await user.type(
      await screen.findByLabelText("Absolute path to a Playwright project"),
      "/tmp/p"
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("エラー")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("入力を編集すると前回の error が解除される", async () => {
    vi.mocked(openProject).mockRejectedValueOnce(new Error("first"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = renderWithQuery();
    const input = await screen.findByLabelText("Absolute path to a Playwright project");
    await user.type(input, "/tmp/p");
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("first")).toBeInTheDocument();

    // 文字列を追加すると onChange が走り、reset で error が消える
    await user.type(input, "x");
    await waitFor(() => {
      expect(screen.queryByText("first")).not.toBeInTheDocument();
    });
  });
});
