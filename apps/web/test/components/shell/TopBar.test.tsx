// TopBar の composition smoke test と aria 経由の構造確認。
// 個別コンポーネントの詳細は各々のテストで担保するため、ここでは「全部入りで動くか」のみ。
// γ (Issue #10) で PersonaToggle が router-aware になったため、Router context wrapper 配下で render する。
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TopBar } from "@/components/shell/TopBar";
import { renderInMinimalRouter } from "../../_helpers/minimal-router";

afterEach(() => cleanup());

interface HarnessProps {
  persona?: "qa" | "dev" | "qmo";
  theme?: "light" | "dark" | "auto";
  canRerun?: boolean;
  isRunning?: boolean;
  projectName?: string | null;
  activeRunId?: string | null;
  activeRunStatus?: import("@pwqa/shared").RunStatus | null;
  onRerun?: () => void;
  onThemeChange?: (n: "light" | "dark" | "auto") => void;
}

function renderHarness({
  persona = "qa",
  theme = "auto",
  canRerun = true,
  isRunning = false,
  projectName = "acme",
  activeRunId = "42",
  activeRunStatus = "passed",
  onRerun = vi.fn(),
  onThemeChange = vi.fn()
}: HarnessProps = {}) {
  const { router, Wrapper } = renderInMinimalRouter(
    <TopBar
      appVersion="9.9.9"
      persona={persona}
      theme={theme}
      onThemeChange={onThemeChange}
      onRerun={onRerun}
      canRerun={canRerun}
      isRunning={isRunning}
      projectName={projectName}
      activeRunId={activeRunId}
      activeRunStatus={activeRunStatus}
    />
  );
  return { router, ...render(<Wrapper />) };
}

describe("TopBar", () => {
  it("Brand / Breadcrumbs / PersonaToggle / RerunButton / ThemeToggle を内包する", async () => {
    renderHarness();
    expect(await screen.findByText("Playwright Workbench")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Project context" })).toBeInTheDocument();
    expect(screen.getByText("acme")).toBeInTheDocument();
    expect(screen.getByText("Run #42")).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Persona view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /再実行/ })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
  });

  it("aria-label='Workbench top bar' を持つ banner", async () => {
    renderHarness();
    expect(
      await screen.findByRole("banner", { name: "Workbench top bar" })
    ).toBeInTheDocument();
  });

  it("PersonaToggle 操作で URL が `/dev` に navigate される", async () => {
    const user = userEvent.setup();
    const { router } = renderHarness({ persona: "qa" });
    await user.click(await screen.findByRole("tab", { name: "Developer" }));
    expect(router.state.location.pathname).toBe("/dev");
  });

  it("ThemeToggle 操作で onThemeChange が dark を渡す", async () => {
    const user = userEvent.setup();
    const onThemeChange = vi.fn();
    renderHarness({ theme: "auto", onThemeChange });
    await user.click(await screen.findByRole("radio", { name: "Dark" }));
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("RerunButton の disabled は canRerun=false で確実に効く", async () => {
    renderHarness({ canRerun: false });
    expect(await screen.findByRole("button", { name: /再実行/ })).toBeDisabled();
  });

  it("project / run が無いときは Breadcrumbs が描画されない", async () => {
    renderHarness({ projectName: null, activeRunId: null, activeRunStatus: null });
    // banner が描画されたら shell 全体は mount 済み (router 解決完了の signal)
    await screen.findByRole("banner", { name: "Workbench top bar" });
    expect(
      screen.queryByRole("navigation", { name: "Project context" })
    ).not.toBeInTheDocument();
  });
});
