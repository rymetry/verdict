// Vitest セットアップ。jsdom 環境向けに jest-dom 拡張マッチャと
// jsdom 未実装の Web API (matchMedia など) を補う。
import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// vite の `define` で注入される `__APP_VERSION__` は本番ビルド時に文字列リテラル化されるが、
// vitest 経由ではビルドが介在しないため undefined のまま参照されてしまう。
// テストでは固定値を仕込み、Brand 等の default 表示が ReferenceError を起こさないようにする。
// (vite-env.d.ts では `declare const __APP_VERSION__: string` 済みのため re-declare を避け、
//  globalThis 上にだけ実値を載せる)
{
  const g = globalThis as Record<string, unknown>;
  if (typeof g.__APP_VERSION__ !== "string") {
    g.__APP_VERSION__ = "0.0.0-test";
  }
}

// Node 25 はネイティブ Web Storage を持つが API が不完全 (setItem/getItem 等が無く
// clear のみのケースあり) で、jsdom の localStorage と衝突して TypeError を起こす。
// テスト全体で安定して動かすため、`window.localStorage` を常にメモリ実装で上書きする。
class InMemoryStorage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}
if (typeof window !== "undefined") {
  // 単一インスタンスを共有することで `vi.spyOn(window.localStorage, ...)` が
  // テスト間で安定して効くようにする
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: new InMemoryStorage()
  });
}

// jsdom は matchMedia を実装しないため、最低限のスタブを提供する。
// useAppStore の auto 経路 / theme-effects の subscribe をテストするため、
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
