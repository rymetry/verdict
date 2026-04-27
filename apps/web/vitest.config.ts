// React コンポーネントを jsdom 環境で実行する Vitest 設定。
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  test: {
    // δ (Issue #11) で QA View の Tailwind 化が完了したため src/** glob は撤去。
    // テストはすべて test/ 配下に集約する。
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: false,
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/api/events.ts",
        "src/components/ui/**",
        "src/components/shell/**",
        "src/features/**",
        "src/hooks/**",
        "src/lib/**",
        "src/store/**"
      ],
      // δ で QA features を移植したため features/** も coverage 対象に追加
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 75
      }
    }
  }
});
