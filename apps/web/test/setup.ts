// Vitest セットアップ。jsdom 環境向けに jest-dom 拡張マッチャを有効化する。
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// 各テスト後に React Testing Library のレンダリングを破棄
afterEach(() => {
  cleanup();
});
