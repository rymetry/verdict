// installThemeEffects() の subscribe / unsubscribe / DOM 反映を検証する。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "@/store/app-store";
import { applyDocumentTheme, installThemeEffects } from "@/store/theme-effects";

beforeEach(() => {
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
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: vi.fn((_type, handler) => {
            handlers.push(handler as MediaHandler);
          }),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn()
        }) as unknown as MediaQueryList
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
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener,
          removeEventListener,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn()
        }) as unknown as MediaQueryList
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
});
