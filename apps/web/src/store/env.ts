// Vite の DEV フラグを SSR / 古環境向けに safe-guard した参照値。
// 同一定義が app-store / run-store / safe-storage に重複していたため共通化。
// import.meta.env が undefined になる runtime (jsdom 古版 / SSR / Node 評価時) でも
// 参照だけで例外にならず boolean を返す。
export const isDev: boolean =
  typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);
