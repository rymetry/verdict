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
    // δ (Issue #11) で Phase 1 features が Tailwind 化されるまでの間、
    // src 配下に残る既存テストも対象に含める (移行後に src/** glob を撤去)
    include: ["test/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: false,
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "src/components/ui/**",
        "src/components/foundation/**",
        "src/hooks/**",
        "src/lib/**"
      ],
      // foundation 範囲では 80% を強制 (Issue #7 受け入れ基準)
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 75
      }
    }
  }
});
