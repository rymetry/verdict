import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { playwrightJsonReportProvider } from "../src/reporting/PlaywrightJsonReportProvider";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-rprovider-")));
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("PlaywrightJsonReportProvider", () => {
  it("throws when the JSON file is absent so the caller can log the read failure", async () => {
    await expect(
      playwrightJsonReportProvider.readSummary({
        projectRoot: workdir,
        runDir: workdir,
        playwrightJsonPath: path.join(workdir, "missing.json")
      })
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns undefined when the JSON file is empty", async () => {
    const file = path.join(workdir, "empty.json");
    fs.writeFileSync(file, "");

    const result = await playwrightJsonReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: file
    });

    expect(result).toBeUndefined();
  });

  it("summarises a Playwright JSON output", async () => {
    const file = path.join(workdir, "results.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        stats: { expected: 2, unexpected: 1, flaky: 0, skipped: 1, duration: 12 },
        suites: []
      })
    );
    const result = await playwrightJsonReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: file
    });
    expect(result?.summary.passed).toBe(2);
    expect(result?.summary.failed).toBe(1);
    expect(result?.summary.skipped).toBe(1);
    expect(result?.summary.total).toBe(4);
  });

  it("resolves bare spec file names under tests/ when Playwright JSON omits testDir", async () => {
    fs.mkdirSync(path.join(workdir, "tests"), { recursive: true });
    fs.writeFileSync(path.join(workdir, "tests", "example.spec.ts"), "test('x', () => {})");
    const file = path.join(workdir, "results.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        stats: { expected: 0, unexpected: 1, flaky: 0, skipped: 0, duration: 12 },
        suites: [
          {
            file: "example.spec.ts",
            specs: [
              {
                title: "fails",
                file: "example.spec.ts",
                line: 3,
                tests: [
                  {
                    id: "t1",
                    status: "unexpected",
                    results: [{ status: "failed", error: { message: "boom" } }]
                  }
                ]
              }
            ]
          }
        ]
      })
    );
    const result = await playwrightJsonReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: file
    });

    expect(result?.summary.failedTests[0]?.relativeFilePath).toBe("tests/example.spec.ts");
    expect(result?.summary.failedTests[0]?.filePath).toBe(
      path.join(workdir, "tests", "example.spec.ts")
    );
  });

  it("does not invent root-level paths for unresolved bare spec file names", async () => {
    const file = path.join(workdir, "results.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        stats: { expected: 0, unexpected: 1, flaky: 0, skipped: 0, duration: 12 },
        suites: [
          {
            file: "missing.spec.ts",
            specs: [
              {
                title: "fails",
                file: "missing.spec.ts",
                tests: [
                  {
                    id: "t1",
                    status: "unexpected",
                    results: [{ status: "failed", error: { message: "boom" } }]
                  }
                ]
              }
            ]
          }
        ]
      })
    );
    const result = await playwrightJsonReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: file
    });

    expect(result?.summary.failedTests[0]?.filePath).toBeUndefined();
    expect(result?.summary.failedTests[0]?.relativeFilePath).toBeUndefined();
  });
});
