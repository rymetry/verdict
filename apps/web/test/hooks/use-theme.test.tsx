// useTheme フックの永続化 / 復元 / 不正値フォールバック / Safari Private Mode シナリオを検証する
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "@/hooks/use-theme";

const STORAGE_KEY = "pwqa-theme";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

beforeEach(() => {
  // 念のため毎テスト前にクリア
  window.localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-preference");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTheme()", () => {
  it("初期値は auto (localStorage 空のとき)", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("auto");
  });

  it("setTheme で localStorage へ書き込まれる", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setTheme("dark"));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(result.current.theme).toBe("dark");
  });

  it("既存の localStorage 値で初期化される", () => {
    window.localStorage.setItem(STORAGE_KEY, "light");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("light");
  });

  it("不正値の場合は auto へフォールバックする", () => {
    window.localStorage.setItem(STORAGE_KEY, "neon-pink");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("auto");
  });

  it("dark 選択時に <html> へ .dark クラスと data-theme=dark が付く", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setTheme("dark"));
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("dark");
  });

  it("localStorage が throw しても初期化が成功する (Safari Private Mode)", () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError: localStorage is not available");
      });
    expect(() => renderHook(() => useTheme(), { wrapper })).not.toThrow();
    getItemSpy.mockRestore();
  });

  it("localStorage の setItem が throw しても setTheme は例外を投げない", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => act(() => result.current.setTheme("dark"))).not.toThrow();
    expect(result.current.theme).toBe("dark");
    setItemSpy.mockRestore();
  });

  it("ThemeProvider の外で useTheme を呼ぶと例外", () => {
    // React 19 では console.error が出るため抑制
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useTheme())).toThrow(
      /must be used within a <ThemeProvider>/
    );
    errSpy.mockRestore();
  });

  it("UI からの切替で resolvedTheme が更新される", async () => {
    function Probe() {
      const { resolvedTheme, setTheme } = useTheme();
      return (
        <div>
          <span data-testid="resolved">{resolvedTheme}</span>
          <button onClick={() => setTheme("dark")}>to-dark</button>
          <button onClick={() => setTheme("light")}>to-light</button>
        </div>
      );
    }
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "to-dark" }));
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    await userEvent.click(screen.getByRole("button", { name: "to-light" }));
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
  });
});
