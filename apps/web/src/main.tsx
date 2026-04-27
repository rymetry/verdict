// Vite エントリポイント。Provider 設置と root mount のみを担う薄い層に保つ。
// App ロジック本体は `App.tsx` 側に分離している (integration test 容易性のため)。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// 自前ホストのフォントを globals.css より前に import する。
// FOUC 抑止に加え、`@font-face` を base layer 適用前に登録することで
// 初回フレームから正しい font-family が解決される。
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-jp/700.css";

import { App } from "./App";
import { FoundationPreview } from "./components/foundation/FoundationPreview";
import { installThemeEffects } from "./store/theme-effects";

import "./styles/globals.css";
// TODO(issue-#11): δ で QA View を Tailwind 化したタイミングで削除する。
// それまでは既存 Phase 1 features の見た目を維持する目的の暫定スタイル。
import "./styles.css";

// React tree の外で 1 回だけ install する。
// React Provider ではないため tree への配置は不要で、subscribe 重複や StrictMode の
// 二重 mount を避けるためにモジュール top-level で実行する (HMR 時の多重 install は
// theme-effects 自身が idempotent なので安全)。
installThemeEffects();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: false }
  }
});

/**
 * `?foundation=1` クエリで基盤プリミティブのプレビューに切替えられる。
 * δ (Issue #11) で QA View 全体が Tailwind に移行した時点で `FoundationPreview` は使い道が
 * 消えるため、本関数 + import + ファイル群 (`apps/web/src/components/foundation/**`) を一括削除する。
 *
 * URL 解析で例外が起きた場合は通常 App にフォールバックする。
 * Foundation Preview に行けないだけで、実機能を白画面化させない。
 */
function isFoundationPreview(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("foundation") === "1";
  } catch (error) {
    // location.search 改竄 / 不正 URL 等で URLSearchParams が throw する稀な経路。
    // 通常 App にフォールバックするのが正しい挙動だが、silent にせず dev で痕跡を残す。
    if (typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV)) {
      // eslint-disable-next-line no-console -- 開発時の診断目的に限定
      console.warn("[main] isFoundationPreview: URLSearchParams 解析失敗", error);
    }
    return false;
  }
}

// `index.html` のマウントポイント取得を明示エラーにする (null 断言はサイレント失敗を生む)
const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error('Root element "#root" not found in index.html. Cannot mount React app.');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isFoundationPreview() ? <FoundationPreview /> : <App />}
    </QueryClientProvider>
  </StrictMode>
);
