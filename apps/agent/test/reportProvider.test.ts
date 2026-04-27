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
  it("returns undefined when the JSON file is absent", async () => {
    const result = await playwrightJsonReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "missing.json")
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
});
