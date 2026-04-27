import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.smoke.spec.ts",
  reporter: [["list"]],
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 }
  },
  projects: [{ name: "chromium", use: { ...{ browserName: "chromium" } } }]
});
