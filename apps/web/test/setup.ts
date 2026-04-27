// Vitest セットアップ。jsdom 環境向けに jest-dom 拡張マッチャと
// jsdom 未実装の Web API (matchMedia など) を補う。
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom は matchMedia を実装しないため、最低限のスタブを提供する。
// useTheme の auto 経路や matchMedia 変更ハンドラをテストするため、
// 個別テストで `vi.spyOn(window, "matchMedia")` で上書きできる形にしておく。
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  type Listener = (event: MediaQueryListEvent) => void;
  window.matchMedia = (query: string): MediaQueryList => {
    const listeners = new Set<Listener>();
    const mql = {
      matches: false,
      media: query,
      onchange: null as MediaQueryList["onchange"],
      addListener: (listener: Listener | null) => {
        if (listener) listeners.add(listener);
      },
      removeListener: (listener: Listener | null) => {
        if (listener) listeners.delete(listener);
      },
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.add(listener as Listener);
      },
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.delete(listener as Listener);
      },
      dispatchEvent: () => true
    };
    return mql as unknown as MediaQueryList;
  };
}

// 各テスト後に React Testing Library のレンダリングと <html> 状態をリセット
afterEach(() => {
  cleanup();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-preference");
  vi.restoreAllMocks();
});
