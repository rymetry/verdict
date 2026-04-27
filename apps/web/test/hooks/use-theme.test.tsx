// useTheme フックの永続化 / 復元 / 不正値フォールバック / Safari Private Mode シナリオ /
// auto モードでの matchMedia 連動 / クリーンアップを検証する
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isThemePreference, ThemeProvider, useTheme } from "@/hooks/use-theme";

const STORAGE_KEY = "pwqa-theme";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

beforeEach(() => {
  // 前テストの永続化が漏れると初期値テストが偽陽性になるため明示クリア。
  // Node 25 のネイティブ Web Storage は jsdom と API が異なり `clear()` が無いため、
  // 既知のキーを直接 removeItem する形にしてランタイム差を吸収する。
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 環境依存の例外は無視 (テスト前提条件ではない)
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isThemePreference()", () => {
  it.each(["light", "dark", "auto"])("有効値 %s を受理する", (v) => {
    expect(isThemePreference(v)).toBe(true);
  });
  it.each(["", "neon-pink", null, undefined, 0])("無効値 %s を弾く", (v) => {
    expect(isThemePreference(v)).toBe(false);
  });
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

  it("既存の localStorage 値 light で初期化される", () => {
    window.localStorage.setItem(STORAGE_KEY, "light");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("light");
  });

  it("既存の localStorage 値 auto で初期化される", () => {
    window.localStorage.setItem(STORAGE_KEY, "auto");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("auto");
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

  it("auto モード + システムが dark 設定で resolvedTheme=dark になる", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn()
        }) as unknown as MediaQueryList
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("auto");
    expect(result.current.resolvedTheme).toBe("dark");
  });

  it("matchMedia change イベントで resolvedTheme が再計算される", () => {
    let registered: ((event: MediaQueryListEvent) => void) | null = null;
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: vi.fn((_type, handler) => {
            registered = handler as (event: MediaQueryListEvent) => void;
          }),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn()
        }) as unknown as MediaQueryList
    );
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.resolvedTheme).toBe("light");
    act(() => {
      registered?.({ matches: true } as MediaQueryListEvent);
    });
    expect(result.current.resolvedTheme).toBe("dark");
  });

  it("matchMedia の addEventListener が無い古環境では addListener を使う", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener,
          removeListener,
          dispatchEvent: vi.fn()
          // addEventListener / removeEventListener は意図的に省略
        }) as unknown as MediaQueryList
    );
    const { unmount } = renderHook(() => useTheme(), { wrapper });
    expect(addListener).toHaveBeenCalledTimes(1);
    unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it("matchMedia 自体が throw しても初期化が落ちない", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(() => {
      throw new SyntaxError("invalid media query");
    });
    expect(() => renderHook(() => useTheme(), { wrapper })).not.toThrow();
  });

  it("localStorage が throw しても初期化が成功する (Safari Private Mode)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: localStorage is not available");
    });
    expect(() => renderHook(() => useTheme(), { wrapper })).not.toThrow();
  });

  it("localStorage の setItem が throw しても setTheme は例外を投げない (Quota 超過)", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => act(() => result.current.setTheme("dark"))).not.toThrow();
    // 仕様: 永続化に失敗しても state は更新する (UI は反応する)
    expect(result.current.theme).toBe("dark");
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
