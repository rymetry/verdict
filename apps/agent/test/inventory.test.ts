import { describe, expect, it } from "vitest";
import { parsePlaywrightListJson } from "../src/project/inventory.js";

const SAMPLE = JSON.stringify({
  config: { rootDir: "/repo" },
  suites: [
    {
      title: "auth.spec.ts",
      file: "tests/auth.spec.ts",
      specs: [
        {
          file: "tests/auth.spec.ts",
          tests: [
            {
              title: "logs in with valid credentials",
              id: "abc123",
              line: 5,
              column: 3,
              tags: ["@smoke"],
              tests: [{ projectName: "chromium", id: "abc123-chromium", tags: [] }]
            }
          ]
        }
      ],
      suites: [
        {
          title: "errors",
          file: "tests/auth.spec.ts",
          specs: [
            {
              file: "tests/auth.spec.ts",
              tests: [
                {
                  title: "rejects invalid password",
                  line: 12,
                  column: 5,
                  tests: [{ projectName: "webkit" }]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      title: "checkout.spec.ts",
      file: "tests/checkout.spec.ts",
      specs: [
        {
          file: "tests/checkout.spec.ts",
          tests: [
            {
              title: "purchases items",
              line: 9,
              tests: [{ projectName: "chromium" }]
            }
          ]
        }
      ]
    }
  ]
});

describe("parsePlaywrightListJson", () => {
  it("flattens nested suites into spec entries", () => {
    const { specs, errors } = parsePlaywrightListJson("/repo", SAMPLE);
    expect(errors).toEqual([]);
    expect(specs.map((s) => s.relativePath)).toEqual([
      "tests/auth.spec.ts",
      "tests/checkout.spec.ts"
    ]);
    const auth = specs[0];
    expect(auth.tests).toHaveLength(2);
    const [first, second] = auth.tests;
    expect(first.title).toBe("logs in with valid credentials");
    expect(first.tags).toContain("@smoke");
    expect(first.projectName).toBe("chromium");
    expect(second.describePath).toEqual(["errors"]);
    expect(second.projectName).toBe("webkit");
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
