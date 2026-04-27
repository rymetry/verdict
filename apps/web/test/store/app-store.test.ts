// useAppStore の純粋関数 / selector / actions を検証する。
// 初期 state はモジュール import 時に決まるため、各テストで setState で明示リセットする。
// localStorage 永続化は theme-effects 側の subscribe が担うので、本ファイルでは検証しない
// (永続化テストは test/store/theme-effects.test.ts 側で扱う)。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeInitialAppState,
  isThemePreference,
  resolveTheme,
  selectResolvedTheme,
  THEME_STORAGE_KEY,
  useAppStore
} from "@/store/app-store";
import { createMediaQueryListMock } from "../_helpers/match-media";

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
    vi.spyOn(window, "matchMedia").mockImplementation((query) =>
      createMediaQueryListMock({ matches: true, media: query })
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
  it("state.theme を更新する (localStorage 永続化は theme-effects 側で行われる)", () => {
    useAppStore.getState().setTheme("dark");
    expect(useAppStore.getState().theme).toBe("dark");
  });

  it("setTheme 自体は副作用 (storage 書込) を持たないため例外を投げない", () => {
    // 仕様: 永続化は store 外の subscribe が担うので、ストレージ未実装環境でも setTheme は安全
    expect(() => useAppStore.getState().setTheme("dark")).not.toThrow();
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

describe("useAppStore (state shape invariants)", () => {
  it("actions が常に保持される (setState の partial merge 退化検出)", () => {
    // テストが `setState(..., true)` で actions を消す事故を防ぐ
    useAppStore.setState({ theme: "auto", systemDark: false });
    expect(typeof useAppStore.getState().setTheme).toBe("function");
    expect(typeof useAppStore.getState().setSystemDark).toBe("function");
  });
});
