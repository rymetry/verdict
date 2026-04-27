// PersonaToggle の振る舞いを controlled component の契約として検証する。
// - 描画: tablist + 3 つの tab ボタン
// - aria 属性: 選択中の tab が aria-selected="true"
// - 操作: クリックで onValueChange が呼ばれる
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PersonaToggle } from "@/components/shell/PersonaToggle";

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
