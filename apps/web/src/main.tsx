// Vite エントリポイント。Provider 設置と root mount のみを担う薄い層に保つ。
// 画面合成 (shell layout / 各 view) は TanStack Router 配下の routes/* に委譲する。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

// 自前ホストのフォントを globals.css より前に import する。
// FOUC 抑止に加え、`@font-face` を base layer 適用前に登録することで
// 初回フレームから正しい font-family が解決される。
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-jp/700.css";

import { router } from "./router";
import { installThemeEffects } from "./store/theme-effects";

import "./styles/globals.css";

// React tree の外で 1 回だけ install する。
// React Provider ではないため tree への配置は不要で、tree 内で呼ぶと StrictMode 下で
// effect が 2 回 mount/unmount し subscribe/unsubscribe が余分に走るのを避ける目的。
// 補足: Vite は通常 entry (main.tsx) 変更時に full page reload するため HMR 経路で
// 多重 install されるケースは稀。ただし theme-effects / app-store が HMR boundary に
// なる依存変更時は本ファイルの top-level が再評価され listener が累積する可能性がある。
// 厳密な idempotent 化 (`import.meta.hot?.dispose` 経由) は別 issue で扱う。
// 開発時に多重 install を検知するため dev guard を仕込んでおく。
if (
  typeof import.meta !== "undefined" &&
  import.meta.env?.DEV &&
  typeof window !== "undefined"
) {
  const w = window as unknown as { __pwqaThemeInstalled?: boolean };
  if (w.__pwqaThemeInstalled) {
    // eslint-disable-next-line no-console -- 開発時の診断目的に限定
    console.warn("[main] installThemeEffects called twice — HMR listener leak の可能性");
  }
  w.__pwqaThemeInstalled = true;
}
installThemeEffects();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: false }
  }
});

// `index.html` のマウントポイント取得を明示エラーにする (null 断言はサイレント失敗を生む)
const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error('Root element "#root" not found in index.html. Cannot mount React app.');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
