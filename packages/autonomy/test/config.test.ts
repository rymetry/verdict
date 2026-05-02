import { describe, expect, it } from "vitest";
import { defaultConfig, resolveWorkflow } from "../src/config.js";

describe("resolveWorkflow", () => {
  it("uses the default lifecycle without deploy stages", () => {
    expect(resolveWorkflow(defaultConfig())).toEqual([
      "think",
      "plan",
      "build",
      "qa-only",
      "review",
      "ship",
      "learn"
    ]);
  });

  it("adds deploy and canary stages when deploy config is present", () => {
    const config = {
      ...defaultConfig(),
      deploy: {
        enabled: true,
        environment: "staging" as const,
        provider: "vercel-compatible"
      }
    };

    expect(resolveWorkflow(config)).toEqual([
      "think",
      "plan",
      "build",
      "qa-only",
      "review",
      "ship",
      "land-and-deploy",
      "canary",
      "learn"
    ]);
  });

  it("keeps learn as the final stage even when custom stages omit it", () => {
    const config = {
      ...defaultConfig(),
      workflow: {
        stages: ["think", "plan", "build", "ship"] as const
      }
    };

    expect(resolveWorkflow(config)).toEqual(["think", "plan", "build", "ship", "learn"]);
  });

  it("can include design review stages for UI-heavy projects", () => {
    const config = {
      ...defaultConfig(),
      workflow: {
        stages: ["think", "plan", "build", "qa-only", "review", "ship", "learn"] as const,
        includeDesignReview: true
      }
    };

    expect(resolveWorkflow(config)).toEqual([
      "think",
      "plan",
      "plan-design-review",
      "build",
      "qa-only",
      "design-review",
      "review",
      "ship",
      "learn"
    ]);
  });
});
