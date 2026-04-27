// PersonaToggle の振る舞いを controlled component の契約として検証する。
// γ (Issue #10) で navigate ベースに変更されたため、テストは Router context 配下で render する。
//  - 描画: tablist + 3 つの tab ボタン
//  - aria 属性: 選択中の tab が aria-selected="true"
//  - 操作: クリックで navigate が呼ばれる (URL pathname が更新)
//  - guard: 値域外の文字列は dispatch されず console.error される
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { dispatchPersonaSafely, PersonaToggle } from "@/components/shell/PersonaToggle";
import type { PersonaView } from "@/lib/persona-view";
import { renderInMinimalRouter } from "../../_helpers/minimal-router";

afterEach(() => cleanup());

function renderToggle(value: PersonaView) {
  const { router, Wrapper } = renderInMinimalRouter(<PersonaToggle value={value} />);
  return { router, ...render(<Wrapper />) };
}

describe("PersonaToggle", () => {
  it("3 つの tab を描画する", async () => {
    renderToggle("qa");
    expect(await screen.findByRole("tab", { name: "QA" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Developer" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Insights" })).toBeInTheDocument();
  });

  it("tablist の aria-label を持つ", async () => {
    renderToggle("qa");
    expect(await screen.findByRole("tablist", { name: "Persona view" })).toBeInTheDocument();
  });

  it("選択中 tab に aria-selected=true、それ以外は false が付く", async () => {
    renderToggle("dev");
    expect(await screen.findByRole("tab", { name: "QA" })).toHaveAttribute(
      "aria-selected",
      "false"
    );
    expect(screen.getByRole("tab", { name: "Developer" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Insights" })).toHaveAttribute("aria-selected", "false");
  });

  it("3 つすべての persona で aria-selected が遷移する (parameterized)", async () => {
    type Case = { value: PersonaView; selected: string };
    const cases: ReadonlyArray<Case> = [
      { value: "qa", selected: "QA" },
      { value: "dev", selected: "Developer" },
      { value: "qmo", selected: "Insights" }
    ];
    for (const { value, selected } of cases) {
      cleanup();
      renderToggle(value);
      expect(await screen.findByRole("tab", { name: selected })).toHaveAttribute(
        "aria-selected",
        "true"
      );
    }
  });

  it("tab クリックで navigate が走り URL pathname が更新される", async () => {
    // ユニットテストでは「navigate を呼び出す」契約のみ検証する。
    // 連続遷移時の active 同期 / 戻る挙動は test/routes/router.test.tsx (full routeTree) で検証。
    const user = userEvent.setup();
    const { router } = renderToggle("qa");

    await user.click(await screen.findByRole("tab", { name: "Developer" }));
    expect(router.state.location.pathname).toBe("/dev");
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

  it("invalid な値は onValueChange に転送せず console.error する (production でも検出可能)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onChange = vi.fn();
    dispatchPersonaSafely("admin", onChange);
    dispatchPersonaSafely("", onChange);
    expect(onChange).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy.mock.calls[0][0]).toMatch(/PersonaToggle.*admin/);
    expect(errorSpy.mock.calls[1][0]).toMatch(/PersonaToggle/);
    errorSpy.mockRestore();
  });
});
