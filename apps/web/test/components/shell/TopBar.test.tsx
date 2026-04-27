// TopBar の composition smoke test と aria 経由の構造確認。
// 個別コンポーネントの詳細は各々のテストで担保するため、ここでは「全部入りで動くか」のみ。
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TopBar } from "@/components/shell/TopBar";

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
  onPersonaChange?: (n: "qa" | "dev" | "qmo") => void;
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
  onPersonaChange = vi.fn(),
  onThemeChange = vi.fn()
}: HarnessProps = {}) {
  return render(
    <TopBar
      appVersion="9.9.9"
      persona={persona}
      onPersonaChange={onPersonaChange}
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
}

describe("TopBar", () => {
  it("Brand / Breadcrumbs / PersonaToggle / RerunButton / ThemeToggle を内包する", () => {
    renderHarness();
    // brand
    expect(screen.getByText("Playwright Workbench")).toBeInTheDocument();
    // breadcrumbs
    expect(screen.getByRole("navigation", { name: "Project context" })).toBeInTheDocument();
    expect(screen.getByText("acme")).toBeInTheDocument();
    expect(screen.getByText("Run #42")).toBeInTheDocument();
    // persona tabs
    expect(screen.getByRole("tablist", { name: "Persona view" })).toBeInTheDocument();
    // rerun
    expect(screen.getByRole("button", { name: /再実行/ })).toBeInTheDocument();
    // theme
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
  });

  it("aria-label='Workbench top bar' を持つ banner", () => {
    renderHarness();
    expect(
      screen.getByRole("banner", { name: "Workbench top bar" })
    ).toBeInTheDocument();
  });

  it("PersonaToggle 操作で onPersonaChange が dev を渡す", async () => {
    const user = userEvent.setup();
    const onPersonaChange = vi.fn();
    renderHarness({ persona: "qa", onPersonaChange });
    await user.click(screen.getByRole("tab", { name: "Developer" }));
    expect(onPersonaChange).toHaveBeenCalledWith("dev");
  });

  it("ThemeToggle 操作で onThemeChange が dark を渡す", async () => {
    const user = userEvent.setup();
    const onThemeChange = vi.fn();
    renderHarness({ theme: "auto", onThemeChange });
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("RerunButton の disabled は canRerun=false で確実に効く", () => {
    renderHarness({ canRerun: false });
    expect(screen.getByRole("button", { name: /再実行/ })).toBeDisabled();
  });

  it("project / run が無いときは Breadcrumbs が描画されない", () => {
    renderHarness({ projectName: null, activeRunId: null, activeRunStatus: null });
    expect(
      screen.queryByRole("navigation", { name: "Project context" })
    ).not.toBeInTheDocument();
  });
});
