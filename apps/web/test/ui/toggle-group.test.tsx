// ToggleGroup primitive (Radix UI) の選択挙動テスト
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

describe("<ToggleGroup />", () => {
  it("単一選択時に value が onValueChange へ伝わる", async () => {
    const onValueChange = vi.fn();
    render(
      <ToggleGroup type="single" onValueChange={onValueChange} aria-label="theme">
        <ToggleGroupItem value="light">light</ToggleGroupItem>
        <ToggleGroupItem value="dark">dark</ToggleGroupItem>
      </ToggleGroup>
    );
    await userEvent.click(screen.getByRole("radio", { name: "dark" }));
    expect(onValueChange).toHaveBeenCalledWith("dark");
  });

  it("選択中の Item に data-state=on が付与される", async () => {
    render(
      <ToggleGroup type="single" defaultValue="light" aria-label="theme">
        <ToggleGroupItem value="light">light</ToggleGroupItem>
        <ToggleGroupItem value="dark">dark</ToggleGroupItem>
      </ToggleGroup>
    );
    expect(screen.getByRole("radio", { name: "light" })).toHaveAttribute(
      "data-state",
      "on"
    );
    expect(screen.getByRole("radio", { name: "dark" })).toHaveAttribute(
      "data-state",
      "off"
    );
  });

  it("type=multiple では複数選択時に配列で値が伝わる", async () => {
    const onValueChange = vi.fn();
    render(
      <ToggleGroup type="multiple" onValueChange={onValueChange} aria-label="filters">
        <ToggleGroupItem value="pass">pass</ToggleGroupItem>
        <ToggleGroupItem value="fail">fail</ToggleGroupItem>
      </ToggleGroup>
    );
    await userEvent.click(screen.getByRole("button", { name: "pass" }));
    expect(onValueChange).toHaveBeenLastCalledWith(["pass"]);
    await userEvent.click(screen.getByRole("button", { name: "fail" }));
    expect(onValueChange).toHaveBeenLastCalledWith(["pass", "fail"]);
  });
});
