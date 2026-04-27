// useAppStore の純粋関数 / selector / actions を検証する。
// 初期 state はモジュール import 時に決まるため、各テストで setState で明示リセットする。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeInitialAppState,
  isThemePreference,
  resolveTheme,
  selectResolvedTheme,
  THEME_STORAGE_KEY,
  useAppStore
} from "@/store/app-store";

beforeEach(() => {
  // localStorage 残骸 / 直前テストの state を初期化
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  useAppStore.setState({ theme: "auto", systemDark: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isThemePreference()", () => {
  it.each(["light", "dark", "auto"])("有効値 %s を受理する", (v) => {
    expect(isThemePreference(v)).toBe(true);
  });
  it.each(["", "neon-pink", null, undefined, 0, {}])("無効値を弾く", (v) => {
    expect(isThemePreference(v)).toBe(false);
  });
});

describe("resolveTheme()", () => {
  it("auto + systemDark=true → dark", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
  });
  it("auto + systemDark=false → light", () => {
    expect(resolveTheme("auto", false)).toBe("light");
  });
  it("light は systemDark に関わらず light", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
  });
  it("dark は systemDark に関わらず dark", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("computeInitialAppState()", () => {
  it("localStorage 空のとき theme=auto", () => {
    expect(computeInitialAppState().theme).toBe("auto");
  });

  it("localStorage の有効値で初期化される", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(computeInitialAppState().theme).toBe("dark");
  });

  it("localStorage に値域外文字列があれば auto フォールバック", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "neon-pink");
    expect(computeInitialAppState().theme).toBe("auto");
  });

  it("matchMedia=true なら systemDark=true", () => {
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
    expect(computeInitialAppState().systemDark).toBe(true);
  });

  it("matchMedia が throw しても落ちずに systemDark=false", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(() => {
      throw new SyntaxError("invalid media query");
    });
    expect(computeInitialAppState().systemDark).toBe(false);
  });
});

describe("useAppStore.setTheme()", () => {
  it("state.theme を更新する", () => {
    useAppStore.getState().setTheme("dark");
    expect(useAppStore.getState().theme).toBe("dark");
  });

  it("localStorage に書き込む", () => {
    useAppStore.getState().setTheme("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("永続化失敗 (Quota 等) でも state は更新する", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => useAppStore.getState().setTheme("dark")).not.toThrow();
    expect(useAppStore.getState().theme).toBe("dark");
  });
});

describe("useAppStore.setSystemDark()", () => {
  it("state.systemDark を更新する", () => {
    useAppStore.getState().setSystemDark(true);
    expect(useAppStore.getState().systemDark).toBe(true);
    useAppStore.getState().setSystemDark(false);
    expect(useAppStore.getState().systemDark).toBe(false);
  });
});

describe("selectResolvedTheme()", () => {
  it("auto + systemDark=true → dark", () => {
    useAppStore.setState({ theme: "auto", systemDark: true });
    expect(selectResolvedTheme(useAppStore.getState())).toBe("dark");
  });

  it("light は固定", () => {
    useAppStore.setState({ theme: "light", systemDark: true });
    expect(selectResolvedTheme(useAppStore.getState())).toBe("light");
  });
});
