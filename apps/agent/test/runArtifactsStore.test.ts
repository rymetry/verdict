import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runArtifactsStore } from "../src/playwright/runArtifactsStore";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-rart-")));
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("runArtifactsStore.redactPlaywrightResults", () => {
  it("no-ops when the file is absent", async () => {
    const result = await runArtifactsStore.redactPlaywrightResults(
      path.join(workdir, "missing.json")
    );
    expect(result.applied).toBe(false);
    expect(result.modified).toBe(false);
    expect(result.replacements).toBe(0);
  });

  it("scrubs known secrets and preserves valid JSON shape", async () => {
    const file = path.join(workdir, "results.json");
    const original = JSON.stringify({
      stats: { expected: 1, unexpected: 1, flaky: 0, skipped: 0 },
      suites: [
        {
          title: "auth",
          specs: [
            {
              title: "logs in",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      error: {
                        message: "Authorization: Bearer abcdefghij1234567890",
                        stack: "token=ghp_abcdefghijklmnopqrst1234"
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });
    fs.writeFileSync(file, original);

    const outcome = await runArtifactsStore.redactPlaywrightResults(file);
    expect(outcome.applied).toBe(true);
    expect(outcome.modified).toBe(true);
    expect(outcome.replacements).toBeGreaterThanOrEqual(2);

    const scrubbed = fs.readFileSync(file, "utf8");
    expect(scrubbed).not.toContain("abcdefghij1234567890");
    expect(scrubbed).not.toContain("ghp_abcdefghijklmnopqrst1234");
    expect(scrubbed).toContain("<REDACTED>");

    // Result must still be valid JSON.
    expect(() => JSON.parse(scrubbed)).not.toThrow();
  });

  it("reports modified=false when redact() is a no-op", async () => {
    const file = path.join(workdir, "clean.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 }, suites: [] })
    );
    const outcome = await runArtifactsStore.redactPlaywrightResults(file);
    expect(outcome.applied).toBe(true);
    expect(outcome.modified).toBe(false);
    expect(outcome.replacements).toBe(0);
  });
});
