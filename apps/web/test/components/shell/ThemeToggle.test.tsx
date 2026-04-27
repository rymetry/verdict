// ThemeToggle の WAI-ARIA radiogroup 準拠と操作仕様を検証する。
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ThemeToggle } from "@/components/shell/ThemeToggle";

afterEach(() => cleanup());

describe("ThemeToggle", () => {
  it("role=radiogroup と aria-label=Theme を持つ", () => {
    render(<ThemeToggle value="auto" onValueChange={vi.fn()} />);
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
  });

  it("3 つの radio ボタン (Light / System / Dark) を描画する", () => {
    render(<ThemeToggle value="auto" onValueChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument();
  });

  it("選択中 radio に aria-checked=true、それ以外は false が付く", () => {
    render(<ThemeToggle value="dark" onValueChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  });

  it("roving tabindex: 選択中のみ 0、非選択は -1", () => {
    render(<ThemeToggle value="auto" onValueChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("tabindex", "-1");
  });

  it("クリックで onValueChange が ThemePreference を引数に呼ばれる", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThemeToggle value="auto" onValueChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(onChange).toHaveBeenCalledWith("light");

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("ArrowRight で次の選択肢へ循環する", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThemeToggle value="auto" onValueChange={onChange} />);

    // 選択中の System (index 1) から ArrowRight で Dark (index 2) へ
    const system = screen.getByRole("radio", { name: "System" });
    system.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("dark");
  });

  it("ArrowLeft で前の選択肢へ循環する (Light の左は Dark)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThemeToggle value="light" onValueChange={onChange} />);

    const light = screen.getByRole("radio", { name: "Light" });
    light.focus();
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("dark");
  });

  it("矢印キー以外では onValueChange を呼ばない", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThemeToggle value="auto" onValueChange={onChange} />);

    const system = screen.getByRole("radio", { name: "System" });
    system.focus();
    await user.keyboard("a");
    expect(onChange).not.toHaveBeenCalled();
  });
});
