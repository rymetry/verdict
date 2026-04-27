// Vite 設定。Tailwind v4 と shadcn/ui の `@/` エイリアスを有効化する。
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ブラウザに露出する build-time 定数。
  // - `__APP_VERSION__` は package.json の version を文字列リテラルとして埋め込む。
  //   shell の brand-sub 表示で参照する。値域は SemVer のため XSS リスクなし。
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  // 本番 build で console を drop しない。
  // PersonaToggle / ThemeToggle / App.tsx の invariant 違反 log は production でも検出可能であるべき
  // (CLAUDE.md `Never silently swallow errors`)。`drop_console: true` は禁止。
  // bundle size 削減目的で console を消したい場合は、`logError(name, payload)` 抽象を導入してから
  // 段階的に置換すること。
  esbuild: {
    drop: []
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    port: 5173,
    // /api と /ws は Hono Local Agent (apps/agent) のローカル既定ポート 4317 へ転送する。
    // Agent 未起動時は React Query 側で "Agent unreachable" 表示にフォールバックする
    // (UI を白画面化させない silent-failure 対策)。
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4317",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, "")
      },
      "/ws": {
        target: "ws://127.0.0.1:4317",
        ws: true,
        rewriteWsOrigin: true
      }
    }
  }
});
