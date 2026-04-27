// Vitest 設定。React コンポーネントを jsdom でテストするため、
// setup ファイルでは @testing-library/jest-dom 拡張マッチャを読み込む。
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
    // src 直下の既存テストと test/ 配下の新規テストを両方拾う
    include: ["test/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: false,
    css: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/components/ui/**", "src/hooks/**", "src/lib/**"]
    }
  }
});
