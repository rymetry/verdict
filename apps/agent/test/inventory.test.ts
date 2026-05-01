import { describe, expect, it } from "vitest";
import { parsePlaywrightListJson } from "../src/project/inventory.js";

const SAMPLE = JSON.stringify({
  config: { rootDir: "/repo/tests" },
  suites: [
    {
      title: "auth.spec.ts",
      file: "auth.spec.ts",
      specs: [
        {
          title: "logs in with valid credentials",
          file: "auth.spec.ts",
          line: 5,
          column: 3,
          tags: ["@smoke"],
          id: "abc123",
          tests: [{ projectName: "chromium", expectedStatus: "passed" }]
        }
      ],
      suites: [
        {
          title: "errors",
          file: "auth.spec.ts",
          specs: [
            {
              title: "rejects invalid password",
              file: "auth.spec.ts",
              line: 12,
              column: 5,
              tags: [],
              tests: [{ projectName: "webkit" }]
            }
          ]
        }
      ]
    },
    {
      title: "checkout.spec.ts",
      file: "checkout.spec.ts",
      specs: [
        {
          title: "purchases items",
          file: "checkout.spec.ts",
          line: 9,
          column: 1,
          tests: [{ projectName: "chromium" }]
        }
      ]
    }
  ]
});

describe("parsePlaywrightListJson", () => {
  it("flattens nested suites and resolves files relative to config.rootDir", () => {
    const { specs, errors } = parsePlaywrightListJson("/repo", SAMPLE);
    expect(errors).toEqual([]);
    expect(specs.map((s) => s.relativePath)).toEqual([
      "tests/auth.spec.ts",
      "tests/checkout.spec.ts"
    ]);
    const auth = specs[0]!;
    expect(auth.tests).toHaveLength(2);
    const [first, second] = auth.tests;
    expect(first!.title).toBe("logs in with valid credentials");
    expect(first!.fullTitle).toBe("logs in with valid credentials");
    expect(first!.tags).toContain("@smoke");
    expect(first!.projectName).toBe("chromium");
    expect(second!.describePath).toEqual(["errors"]);
    expect(second!.fullTitle).toBe("errors > rejects invalid password");
    expect(second!.qaMetadata).toEqual({
      purpose: "errors > rejects invalid password",
      steps: [],
      expectations: [],
      source: "playwright-list-json",
      confidence: "low"
    });
    expect(second!.projectName).toBe("webkit");
  });

  it("returns parse errors for malformed JSON", () => {
    const result = parsePlaywrightListJson("/repo", "not json");
    expect(result.errors[0]).toMatch(/parse/i);
    expect(result.specs).toEqual([]);
  });

  it("propagates Playwright reported errors", () => {
    const sample = JSON.stringify({
      errors: [{ message: "config not found" }],
      suites: []
    });
    const result = parsePlaywrightListJson("/repo", sample);
    expect(result.errors[0]).toContain("config not found");
  });
});
