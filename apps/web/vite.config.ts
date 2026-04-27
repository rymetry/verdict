// Vite 設定。Tailwind v4 と shadcn/ui の `@/` エイリアスを有効化する。
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
