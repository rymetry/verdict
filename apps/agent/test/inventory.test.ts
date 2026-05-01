import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  enrichSpecFilesWithStaticAnalysis,
  parsePlaywrightListJson
} from "../src/project/inventory.js";

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

  it("enriches tests with steps assertions locators and Allure metadata", async () => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-inventory-"));
    try {
      const specDir = path.join(workdir, "tests");
      fs.mkdirSync(specDir, { recursive: true });
      const specPath = path.join(specDir, "checkout.spec.ts");
      fs.writeFileSync(
        specPath,
        [
          "import { test, expect } from '@playwright/test';",
          "import * as allure from 'allure-js-commons';",
          "",
          "test('checkout completes', async ({ page }) => {",
          "  allure.feature('Checkout');",
          "  await test.step('Open checkout', async () => {",
          "    await page.getByRole('link', { name: 'Checkout' }).click();",
          "  });",
          "  await allure.step('Submit payment', async () => {});",
          "  await expect(page.getByText('Order confirmed')).toBeVisible();",
          "});"
        ].join("\n")
      );

      const parsed = parsePlaywrightListJson(
        workdir,
        JSON.stringify({
          config: { rootDir: specDir },
          suites: [
            {
              title: "checkout.spec.ts",
              file: "checkout.spec.ts",
              specs: [
                {
                  title: "checkout completes",
                  file: "checkout.spec.ts",
                  line: 4,
                  column: 0,
                  tests: [{ projectName: "chromium" }]
                }
              ]
            }
          ]
        })
      );

      const enriched = await enrichSpecFilesWithStaticAnalysis(workdir, parsed.specs);
      expect(enriched.warnings).toEqual([]);
      const test = enriched.specs[0]!.tests[0]!;
      expect(test.qaMetadata.source).toBe("static-analysis");
      expect(test.qaMetadata.confidence).toBe("medium");
      expect(test.qaMetadata.steps).toEqual([
        { title: "Open checkout", line: 6 },
        { title: "Submit payment", line: 9 }
      ]);
      expect(test.qaMetadata.expectations).toEqual([
        {
          title: "await expect(page.getByText('Order confirmed')).toBeVisible();",
          line: 10
        }
      ]);
      expect(test.codeSignals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "locator",
            value: "page.getByRole('link', { name: 'Checkout' }).click();",
            line: 7,
            source: "static-analysis"
          }),
          expect.objectContaining({
            kind: "assertion",
            value: "await expect(page.getByText('Order confirmed')).toBeVisible();",
            line: 10,
            source: "static-analysis"
          }),
          expect.objectContaining({
            kind: "locator",
            value: "page.getByText('Order confirmed')).toBeVisible();",
            line: 10,
            source: "static-analysis"
          }),
          expect.objectContaining({
            kind: "allure-metadata",
            value: "allure.feature('Checkout');",
            line: 5,
            source: "allure-metadata"
          })
        ])
      );
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  });
});
