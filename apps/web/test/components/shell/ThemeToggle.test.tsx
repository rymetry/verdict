// ThemeToggle の WAI-ARIA radiogroup 準拠と操作仕様を検証する。
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("ArrowDown は ArrowRight と同方向 (次へ)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThemeToggle value="auto" onValueChange={onChange} />);
    screen.getByRole("radio", { name: "System" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(onChange).toHaveBeenLastCalledWith("dark");
  });

  it("ArrowUp は ArrowLeft と同方向 (前へ)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThemeToggle value="auto" onValueChange={onChange} />);
    screen.getByRole("radio", { name: "System" }).focus();
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith("light");
  });

  it("矢印キー操作で フォーカスが次の radio へ移動する (WAI-ARIA Radio Group 要件)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThemeToggle value="auto" onValueChange={onChange} />);
    const system = screen.getByRole("radio", { name: "System" });
    system.focus();
    await user.keyboard("{ArrowRight}");
    // re-render を待たず value="auto" のままだが、focus は同期的に移動している
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Dark" }));
  });

  it("値域外の value (型を緩めた緊急退避経路) では onValueChange を呼ばず dev で console.error する", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onChange = vi.fn();
    render(
      <ThemeToggle
        value={"invalid" as "light" | "dark" | "auto"}
        onValueChange={onChange}
      />
    );
    // 値域外では tabIndex=0 になる radio が存在せず focus が乗らないため、
    // keydown を radiogroup に対して直接 fire して guard 動線を検証する。
    const radiogroup = screen.getByRole("radiogroup", { name: "Theme" });
    fireEvent.keyDown(radiogroup, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
