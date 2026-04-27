// PersonaToggle の振る舞いを controlled component の契約として検証する。
// - 描画: tablist + 3 つの tab ボタン
// - aria 属性: 選択中の tab が aria-selected="true"
// - 操作: クリックで onValueChange が呼ばれる
// - guard: 値域外の文字列は store にコミットされず dev で console.error される
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { dispatchPersonaSafely, PersonaToggle } from "@/components/shell/PersonaToggle";

afterEach(() => cleanup());

describe("PersonaToggle", () => {
  it("3 つの tab を描画する", () => {
    const onChange = vi.fn();
    render(<PersonaToggle value="qa" onValueChange={onChange} />);
    expect(screen.getByRole("tab", { name: "QA" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Developer" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Insights" })).toBeInTheDocument();
  });

  it("tablist の aria-label を持つ", () => {
    render(<PersonaToggle value="qa" onValueChange={vi.fn()} />);
    expect(screen.getByRole("tablist", { name: "Persona view" })).toBeInTheDocument();
  });

  it("選択中 tab に aria-selected=true、それ以外は false が付く", () => {
    render(<PersonaToggle value="dev" onValueChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "QA" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Developer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Insights" })).toHaveAttribute("aria-selected", "false");
  });

  it("3 つすべての persona で aria-selected が遷移する (parameterized)", () => {
    type Case = { value: "qa" | "dev" | "qmo"; selected: string };
    const cases: ReadonlyArray<Case> = [
      { value: "qa", selected: "QA" },
      { value: "dev", selected: "Developer" },
      { value: "qmo", selected: "Insights" }
    ];
    for (const { value, selected } of cases) {
      cleanup();
      render(<PersonaToggle value={value} onValueChange={vi.fn()} />);
      expect(screen.getByRole("tab", { name: selected })).toHaveAttribute("aria-selected", "true");
    }
  });

  it("tab クリックで onValueChange が当該 PersonaView を引数に呼ばれる", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PersonaToggle value="qa" onValueChange={onChange} />);

    await user.click(screen.getByRole("tab", { name: "Developer" }));
    expect(onChange).toHaveBeenCalledWith("dev");

    await user.click(screen.getByRole("tab", { name: "Insights" }));
    expect(onChange).toHaveBeenCalledWith("qmo");
  });
});

describe("dispatchPersonaSafely (guard 動線)", () => {
  it("valid な PersonaView (qa/dev/qmo) は onValueChange に転送する", () => {
    const onChange = vi.fn();
    dispatchPersonaSafely("qa", onChange);
    dispatchPersonaSafely("dev", onChange);
    dispatchPersonaSafely("qmo", onChange);
    expect(onChange.mock.calls).toEqual([["qa"], ["dev"], ["qmo"]]);
  });

  it("invalid な値は onValueChange に転送せず dev で console.error する", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onChange = vi.fn();
    dispatchPersonaSafely("admin", onChange);
    dispatchPersonaSafely("", onChange);
    expect(onChange).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy.mock.calls[0][0]).toMatch(/PersonaToggle.*admin/);
    errorSpy.mockRestore();
  });
});
