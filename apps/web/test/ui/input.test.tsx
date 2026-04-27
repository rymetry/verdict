// Input primitive のスモークテスト。デザイントークン (focus ring / aria-invalid) と
// disabled が UA defaults を踏み倒す挙動を pin する。
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Input } from "@/components/ui/input";

describe("Input", () => {
  it("既定で type=text として描画される", () => {
    render(<Input data-testid="i" />);
    const el = screen.getByTestId("i") as HTMLInputElement;
    expect(el.type).toBe("text");
  });

  it("type override が効く", () => {
    render(<Input type="search" data-testid="i" />);
    expect((screen.getByTestId("i") as HTMLInputElement).type).toBe("search");
  });

  it("disabled が true のときは onChange が発火しない", async () => {
    const user = userEvent.setup();
    let changes = 0;
    render(<Input disabled onChange={() => changes++} data-testid="i" />);
    await user.type(screen.getByTestId("i"), "abc");
    expect(changes).toBe(0);
  });

  it("aria-invalid=true で fail 系のクラスが当たる", () => {
    render(<Input aria-invalid="true" data-testid="i" />);
    expect(screen.getByTestId("i").className).toMatch(/aria-invalid:border-\[var\(--fail\)\]/);
  });

  it("placeholder text を ink-3 トークンで描画する", () => {
    render(<Input placeholder="検索…" data-testid="i" />);
    expect(screen.getByTestId("i").className).toMatch(/placeholder:text-\[var\(--ink-3\)\]/);
  });
});
