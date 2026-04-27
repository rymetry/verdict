// Router レベルの統合テスト。
// - `/` (index) は `/qa` にリダイレクトされる
// - `/qa` `/dev` `/qmo` をそれぞれ直接開くと該当 view が描画される
// - PersonaToggle のクリックで navigate して URL が更新される
// - ブラウザ back で前 URL に戻る
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

import { createInitialRunState, useRunStore } from "@/store/run-store";
import { renderWithRouter } from "../_helpers/render-with-router";

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
  fetchRun
} from "@/api/client";

vi.mock("@/hooks/use-workbench-events", () => ({
  useWorkbenchEvents: () => ({ events: [], status: "closed" })
}));

beforeEach(() => {
  useRunStore.setState(createInitialRunState(), false);
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
  vi.mocked(fetchRun).mockResolvedValue({
    runId: "noop",
    projectId: "p1",
    projectRoot: "/p",
    status: "passed",
    startedAt: "2026-04-28T00:00:00Z",
    completedAt: "2026-04-28T00:01:00Z",
    command: { executable: "npx", args: ["playwright", "test"] },
    cwd: "/p",
    requested: { projectId: "p1", headed: false },
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
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("router redirect", () => {
  it("`/` へのアクセスは `/qa` に redirect される (履歴も置換)", async () => {
    const { router } = renderWithRouter({ initialPath: "/" });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/qa");
    });
    // index 自体は描画されない (placeholder text 等を持たない)
    expect(screen.getByRole("tab", { name: "QA", selected: true })).toBeInTheDocument();
  });
});

describe("各 persona route の直接アクセス", () => {
  it("`/qa` を直接開くと QA の Run controls / Project picker が描画される", async () => {
    renderWithRouter({ initialPath: "/qa" });
    expect(await screen.findByText("Run controls")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "QA", selected: true })).toBeInTheDocument();
  });

  it("`/dev` を直接開くと Developer View placeholder が描画される", async () => {
    renderWithRouter({ initialPath: "/dev" });
    expect(await screen.findByTestId("dev-view")).toBeInTheDocument();
    expect(screen.getByText(/Developer View/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Developer", selected: true })).toBeInTheDocument();
  });

  it("`/qmo` を直接開くと Insights View placeholder が描画される", async () => {
    renderWithRouter({ initialPath: "/qmo" });
    expect(await screen.findByTestId("qmo-view")).toBeInTheDocument();
    expect(screen.getByText(/Insights View/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Insights", selected: true })).toBeInTheDocument();
  });
});

describe("PersonaToggle クリックで route 遷移する", () => {
  it("QA → Developer → Insights → QA を順に遷移し URL と active tab が同期する", async () => {
    const { user, router } = renderWithRouter({ initialPath: "/qa" });

    await user.click(await screen.findByRole("tab", { name: "Developer" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/dev"));
    expect(screen.getByRole("tab", { name: "Developer", selected: true })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Insights" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/qmo"));
    expect(screen.getByRole("tab", { name: "Insights", selected: true })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "QA" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/qa"));
    expect(screen.getByRole("tab", { name: "QA", selected: true })).toBeInTheDocument();
  });

  it("ブラウザ back で前の URL に戻り tab の active 状態も同期する", async () => {
    const { user, router } = renderWithRouter({ initialPath: "/qa" });
    await user.click(await screen.findByRole("tab", { name: "Developer" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/dev"));

    router.history.back();
    await waitFor(() => expect(router.state.location.pathname).toBe("/qa"));
    expect(screen.getByRole("tab", { name: "QA", selected: true })).toBeInTheDocument();
  });
});
