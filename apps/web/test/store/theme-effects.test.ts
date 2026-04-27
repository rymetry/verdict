// installThemeEffects() の subscribe / unsubscribe / DOM 反映 / 永続化 を検証する。
// app-store の setTheme は state 更新のみを行い、localStorage への persist は
// theme-effects 側の subscribe が担う設計のため、永続化のテストは本ファイルが責任を持つ。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY, useAppStore } from "@/store/app-store";
import { applyDocumentTheme, installThemeEffects } from "@/store/theme-effects";
import { createMediaQueryListMock } from "../_helpers/match-media";

beforeEach(() => {
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  useAppStore.setState({ theme: "auto", systemDark: false });
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-preference");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyDocumentTheme()", () => {
  it("dark で .dark クラスと data 属性を付与する", () => {
    applyDocumentTheme("dark", "dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themePreference).toBe("dark");
  });

  it("light で .dark クラスを除去する", () => {
    document.documentElement.classList.add("dark");
    applyDocumentTheme("light", "auto");
    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themePreference).toBe("auto");
  });
});

describe("installThemeEffects()", () => {
  it("install 時に現在の resolvedTheme を <html> に反映する", () => {
    useAppStore.setState({ theme: "dark", systemDark: false });
    const cleanup = installThemeEffects();
    expect(document.documentElement).toHaveClass("dark");
    cleanup();
  });

  it("store の setTheme に追従して <html> が更新される", () => {
    const cleanup = installThemeEffects();
    expect(document.documentElement).not.toHaveClass("dark");
    useAppStore.getState().setTheme("dark");
    expect(document.documentElement).toHaveClass("dark");
    cleanup();
  });

  it("matchMedia change で setSystemDark が呼ばれて <html> も更新される", () => {
    type MediaHandler = (event: MediaQueryListEvent) => void;
    const handlers: MediaHandler[] = [];
    vi.spyOn(window, "matchMedia").mockImplementation((query) =>
      createMediaQueryListMock({
        media: query,
        addEventListener: vi.fn((_type, handler) => {
          handlers.push(handler as MediaHandler);
        })
      })
    );
    useAppStore.setState({ theme: "auto", systemDark: false });
    const cleanup = installThemeEffects();
    expect(document.documentElement).not.toHaveClass("dark");

    expect(handlers.length).toBe(1);
    handlers[0]({ matches: true } as MediaQueryListEvent);

    expect(useAppStore.getState().systemDark).toBe(true);
    expect(document.documentElement).toHaveClass("dark");
    cleanup();
  });

  it("古い Safari でも addListener 経由で subscribe する", () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    vi.spyOn(window, "matchMedia").mockImplementation((query) =>
      createMediaQueryListMock({
        media: query,
        addListener,
        removeListener,
        // addEventListener / removeEventListener は意図的に省略
        addEventListener: undefined as unknown as MediaQueryList["addEventListener"]
      })
    );
    const cleanup = installThemeEffects();
    expect(addListener).toHaveBeenCalledTimes(1);
    cleanup();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it("cleanup 後は store の変化を <html> に反映しない", () => {
    const cleanup = installThemeEffects();
    cleanup();

    document.documentElement.className = "";
    useAppStore.getState().setTheme("dark");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("cleanup で matchMedia の removeEventListener が呼ばれる", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.spyOn(window, "matchMedia").mockImplementation((query) =>
      createMediaQueryListMock({ media: query, addEventListener, removeEventListener })
    );
    const cleanup = installThemeEffects();
    expect(addEventListener).toHaveBeenCalledTimes(1);
    cleanup();
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("matchMedia 自体が throw しても install が落ちない", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(() => {
      throw new SyntaxError("invalid media query");
    });
    expect(() => {
      const cleanup = installThemeEffects();
      cleanup();
    }).not.toThrow();
  });

  // -- 永続化 (theme-effects subscribe で実装される invariant) --

  it("setTheme で localStorage に書き込まれる (subscribe 経由)", () => {
    const cleanup = installThemeEffects();
    useAppStore.getState().setTheme("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    cleanup();
  });

  it("setState 経路でも localStorage に書き込まれる (action だけに依存しない invariant)", () => {
    const cleanup = installThemeEffects();
    // setTheme を経由せず setState で直接書き換えても persist が走ること
    useAppStore.setState({ theme: "light" });
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    cleanup();
  });

  it("永続化失敗 (Quota 等) でも store 更新と DOM 反映は継続する", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const cleanup = installThemeEffects();
    expect(() => useAppStore.getState().setTheme("dark")).not.toThrow();
    expect(useAppStore.getState().theme).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    cleanup();
  });

  // -- duplicate-install 安全性 (HMR / 二重 install) --

  it("複数回 install しても DOM 反映は壊れず、cleanup 後は subscribe 漏れなし", () => {
    const cleanup1 = installThemeEffects();
    const cleanup2 = installThemeEffects();
    useAppStore.getState().setTheme("dark");
    expect(document.documentElement).toHaveClass("dark");
    // 全 cleanup 後に store 変化が DOM に伝播しないこと
    cleanup1();
    cleanup2();
    document.documentElement.className = "";
    useAppStore.getState().setTheme("light");
    expect(document.documentElement).not.toHaveClass("dark");
  });

  // -- cleanup の symmetric 解除 (片方 throw でも他方を必ず呼ぶ) --

  it("片方の unsubscribe が throw しても matchMedia の removeEventListener は呼ばれる", () => {
    const removeEventListener = vi.fn();
    vi.spyOn(window, "matchMedia").mockImplementation((query) =>
      createMediaQueryListMock({ media: query, removeEventListener })
    );
    // store unsubscribe を throw 化
    const subscribeSpy = vi.spyOn(useAppStore, "subscribe").mockImplementation(() => {
      return () => {
        throw new Error("simulated unsubscribe failure");
      };
    });
    const cleanup = installThemeEffects();
    expect(() => cleanup()).toThrow("simulated unsubscribe failure");
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    subscribeSpy.mockRestore();
  });
});
