import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.spec.ts",
  reporter: [["list"]],
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 }
  },
  projects: [{ name: "chromium", use: { ...{ browserName: "chromium" } } }]
});
