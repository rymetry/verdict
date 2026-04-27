// FoundationPreview の smoke レンダリングと Zustand selector 経由のテーマ切替を検証する。
// - useAppStore の atomic selector が React tree から正しく購読できているか
// - ToggleGroup → setTheme → store 反映の経路が壊れていないか
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { FoundationPreview } from "@/components/foundation/FoundationPreview";
import { THEME_STORAGE_KEY, useAppStore } from "@/store/app-store";

beforeEach(() => {
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  useAppStore.setState({ theme: "auto", systemDark: false });
});

describe("<FoundationPreview />", () => {
  it("主要 primitives がレンダリングされる", () => {
    render(<FoundationPreview />);
    expect(screen.getByRole("heading", { name: /Tailwind v4/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再実行" })).toBeInTheDocument();
    expect(screen.getByText(/合格 24/)).toBeInTheDocument();
  });

  it("テーマトグルクリックで store の theme が更新される", async () => {
    render(<FoundationPreview />);
    expect(useAppStore.getState().theme).toBe("auto");
    await userEvent.click(screen.getByRole("radio", { name: "ダークモード" }));
    expect(useAppStore.getState().theme).toBe("dark");
  });

  it("resolvedTheme を反映した表示モード文言が出る", () => {
    useAppStore.setState({ theme: "dark", systemDark: false });
    render(<FoundationPreview />);
    expect(screen.getByText(/表示モード:\s*dark/)).toBeInTheDocument();
  });
});
