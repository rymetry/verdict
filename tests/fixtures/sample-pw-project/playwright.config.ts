import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  reporter: [["list"]],
  // Browsers are NOT used in the integration smoke (we only call --list).
  // The Workbench Phase 1 verifies inventory + run pipeline plumbing; Phase 1.2
  // will exercise actual browser launches against this fixture.
  use: {}
});
