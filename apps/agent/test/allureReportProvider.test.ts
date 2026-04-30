import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allureReportProvider } from "../src/reporting/AllureReportProvider.js";

let workdir: string;
let allureResultsDir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-allure-")));
  allureResultsDir = path.join(workdir, "allure-results");
  fs.mkdirSync(allureResultsDir, { recursive: true });
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

interface AllureResultLike {
  uuid: string;
  fullName?: string;
  name?: string;
  status: "passed" | "failed" | "broken" | "skipped" | "unknown";
  start?: number;
  stop?: number;
  labels?: Array<{ name: string; value: string }>;
  attachments?: Array<{ name: string; source: string; type?: string }>;
  statusDetails?: { message?: string; trace?: string };
}

function writeAllureResult(uuid: string, body: AllureResultLike): void {
  const filename = `${uuid}-result.json`;
  fs.writeFileSync(path.join(allureResultsDir, filename), JSON.stringify(body));
}

describe("AllureReportProvider", () => {
  it("returns undefined for an empty allure-results directory (no data signal)", async () => {
    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored-by-this-provider.json"),
    });
    expect(result).toBeUndefined();
  });

  it("returns undefined when the allure-results directory is missing (§1.1: silent skip for non-Allure projects)", async () => {
    // §1.1 wired this provider into the default composite. A missing
    // allure-results dir is the normal case for plain Playwright projects,
    // so the provider must NOT throw — that would force the composite to
    // emit a noisy warning on every run. EACCES / EIO etc still propagate
    // (covered indirectly by readAllureResults' contract; see
    // allureResultsReader.test.ts).
    fs.rmSync(allureResultsDir, { recursive: true, force: true });
    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });
    expect(result).toBeUndefined();
  });

  it("aggregates a single passing result", async () => {
    writeAllureResult("uuid-1", {
      uuid: "uuid-1",
      fullName: "tests/example.spec.ts > passes a trivial assertion",
      name: "passes a trivial assertion",
      status: "passed",
      start: 1000,
      stop: 1050,
    });

    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });

    expect(result?.summary.passed).toBe(1);
    expect(result?.summary.failed).toBe(0);
    expect(result?.summary.skipped).toBe(0);
    expect(result?.summary.total).toBe(1);
    expect(result?.summary.failedTests).toEqual([]);
    expect(result?.summary.durationMs).toBe(50);
    expect(result?.warnings).toEqual([]);
  });

  it("collects failed test details with statusDetails / labels / attachments", async () => {
    writeAllureResult("uuid-fail", {
      uuid: "uuid-fail",
      fullName: "tests/example.spec.ts > fails an assertion",
      name: "fails an assertion",
      status: "failed",
      start: 2000,
      stop: 2200,
      labels: [
        { name: "tag", value: "smoke" },
        { name: "package", value: "tests/example.spec.ts" },
      ],
      attachments: [
        { name: "screenshot", source: "abc-attachment.png", type: "image/png" },
        { name: "trace", source: "def-trace.zip", type: "application/zip" },
      ],
      statusDetails: {
        message: "expected 2 to be 3",
        trace: "  at example.spec.ts:5",
      },
    });

    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });

    expect(result?.summary.failed).toBe(1);
    expect(result?.summary.passed).toBe(0);
    expect(result?.summary.total).toBe(1);
    expect(result?.summary.failedTests).toHaveLength(1);
    const failedTest = result!.summary.failedTests[0]!;
    expect(failedTest.testId).toBe("uuid-fail");
    expect(failedTest.title).toBe("fails an assertion");
    expect(failedTest.fullTitle).toBe("tests/example.spec.ts > fails an assertion");
    expect(failedTest.filePath).toBe(path.join(workdir, "tests/example.spec.ts"));
    expect(failedTest.message).toBe("expected 2 to be 3");
    expect(failedTest.stack).toBe("  at example.spec.ts:5");
    expect(failedTest.durationMs).toBe(200);
    expect(failedTest.attachments).toHaveLength(2);
    expect(failedTest.attachments?.[0]).toMatchObject({
      kind: "screenshot",
      path: "abc-attachment.png",
      label: "screenshot",
    });
    expect(failedTest.attachments?.[1]).toMatchObject({
      kind: "trace",
      path: "def-trace.zip",
      label: "trace",
    });
  });

  it("treats Allure 'broken' as failed, surfaces ALLURE_BROKEN_TEST code, and preserves raw status in failedTests", async () => {
    writeAllureResult("uuid-broken", {
      uuid: "uuid-broken",
      name: "fixture setup throws",
      status: "broken",
      start: 0,
      stop: 100,
      statusDetails: { message: "before-each hook failed" },
    });

    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });

    expect(result?.summary.failed).toBe(1);
    expect(result?.summary.passed).toBe(0);
    expect(result?.summary.failedTests).toHaveLength(1);
    // The shared TestResultSummary collapses broken into failed counter,
    // but failedTests[i].status preserves the raw "broken" string so QMO
    // View (Phase 5) can `filter(t => t.status === "broken")`.
    expect(result?.summary.failedTests[0]?.status).toBe("broken");
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ALLURE_BROKEN_TEST"),
      ])
    );
  });

  it("aggregates skipped results without listing them as failed", async () => {
    writeAllureResult("uuid-skip", {
      uuid: "uuid-skip",
      name: "intentionally skipped",
      status: "skipped",
    });

    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });

    expect(result?.summary.skipped).toBe(1);
    expect(result?.summary.passed).toBe(0);
    expect(result?.summary.failed).toBe(0);
    expect(result?.summary.total).toBe(1);
    expect(result?.summary.failedTests).toEqual([]);
  });

  it("excludes 'unknown' status from counts and surfaces ALLURE_UNKNOWN_STATUS code", async () => {
    writeAllureResult("uuid-unknown", {
      uuid: "uuid-unknown",
      name: "interrupted before completion",
      status: "unknown",
      start: 0,
      stop: 50,
    });
    writeAllureResult("uuid-pass", {
      uuid: "uuid-pass",
      name: "passes",
      status: "passed",
      start: 0,
      stop: 100,
    });

    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });

    expect(result?.summary.passed).toBe(1);
    expect(result?.summary.failed).toBe(0);
    expect(result?.summary.skipped).toBe(0);
    // unknown は count に含めない (passed=1, total=1)
    expect(result?.summary.total).toBe(1);
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ALLURE_UNKNOWN_STATUS"),
      ])
    );
  });

  it("warns ALLURE_MALFORMED_TIMING when start/stop are missing on a non-skipped test", async () => {
    writeAllureResult("uuid-no-timing", {
      uuid: "uuid-no-timing",
      name: "missing start/stop",
      status: "passed",
      // start and stop deliberately omitted
    });

    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });

    expect(result?.summary.passed).toBe(1);
    // Total durationMs is undefined because no entry contributes timing
    expect(result?.summary.durationMs).toBeUndefined();
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ALLURE_MALFORMED_TIMING"),
      ])
    );
  });

  it("does NOT warn malformed timing on legitimately skipped tests", async () => {
    writeAllureResult("uuid-skip", {
      uuid: "uuid-skip",
      name: "intentionally skipped",
      status: "skipped",
      // skipped tests legitimately omit timing
    });

    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });

    expect(result?.summary.skipped).toBe(1);
    expect(result?.warnings).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("ALLURE_MALFORMED_TIMING"),
      ])
    );
  });

  it("warns ALLURE_MALFORMED_TIMING and coerces to 0 when stop < start", async () => {
    writeAllureResult("uuid-negative", {
      uuid: "uuid-negative",
      name: "negative duration",
      status: "passed",
      start: 200,
      stop: 100,
    });

    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });

    expect(result?.summary.passed).toBe(1);
    // Negative coerced to 0 → totalDurationMs is 0 → durationMs becomes undefined
    expect(result?.summary.durationMs).toBeUndefined();
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ALLURE_MALFORMED_TIMING"),
        expect.stringContaining("stop < start"),
      ])
    );
  });

  it("continues parsing other files when one is malformed JSON (best-effort)", async () => {
    writeAllureResult("uuid-good", {
      uuid: "uuid-good",
      name: "passes",
      status: "passed",
    });
    fs.writeFileSync(path.join(allureResultsDir, "broken-result.json"), "{ not valid json");

    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });

    expect(result?.summary.passed).toBe(1);
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("broken-result.json"),
        expect.stringContaining("not valid JSON"),
      ])
    );
  });

  it("continues parsing when one file fails schema validation, includes zod issue paths", async () => {
    writeAllureResult("uuid-good", {
      uuid: "uuid-good",
      name: "passes",
      status: "passed",
      start: 0,
      stop: 10,
    });
    // status field missing → zod validation fails on `status` field
    fs.writeFileSync(
      path.join(allureResultsDir, "schema-bad-result.json"),
      JSON.stringify({ uuid: "x", name: "missing status" })
    );

    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });

    expect(result?.summary.passed).toBe(1);
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("schema-bad-result.json"),
        expect.stringContaining("schema"),
        // zod issue path should surface the failing field name
        expect.stringContaining("issues=status"),
      ])
    );
  });

  it("does not embed the absolute allure-results path in warnings (Issue #27 path-redaction)", async () => {
    fs.writeFileSync(
      path.join(allureResultsDir, "broken-result.json"),
      "{ not valid json"
    );

    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });

    // Warning は basename だけを含み、絶対 path (workdir) は出さない。
    // structured logger に渡された場合に path leakage が起きないことを保証。
    const warningJson = JSON.stringify(result?.warnings ?? []);
    expect(warningJson).not.toContain(workdir);
    expect(warningJson).not.toContain(allureResultsDir);
    expect(result?.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("broken-result.json"),
      ])
    );
  });

  it("ignores non-result files (containers, attachments, environment.properties)", async () => {
    writeAllureResult("uuid-pass", {
      uuid: "uuid-pass",
      name: "passes",
      status: "passed",
      start: 0,
      stop: 10,
    });
    // Allure outputs many other files in the same directory
    fs.writeFileSync(
      path.join(allureResultsDir, "abc-container.json"),
      JSON.stringify({ uuid: "container-1" })
    );
    fs.writeFileSync(
      path.join(allureResultsDir, "abc-attachment.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    );
    fs.writeFileSync(
      path.join(allureResultsDir, "environment.properties"),
      "node=24"
    );

    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });

    // non-*-result.json は無視され、warning も出ない
    expect(result?.summary.total).toBe(1);
    expect(result?.warnings).toEqual([]);
  });

  it("handles fullName-only / name-only entries gracefully", async () => {
    writeAllureResult("uuid-fullname-only", {
      uuid: "uuid-fullname-only",
      fullName: "describe > test fullName only",
      status: "failed",
    });
    writeAllureResult("uuid-name-only", {
      uuid: "uuid-name-only",
      name: "name-only",
      status: "failed",
    });
    writeAllureResult("uuid-no-titles", {
      uuid: "uuid-no-titles",
      status: "failed",
    });

    const result = await allureReportProvider.readSummary({
      projectRoot: workdir,
      runDir: workdir,
      playwrightJsonPath: path.join(workdir, "ignored.json"),
    });

    expect(result?.summary.failed).toBe(3);
    const titles = result!.summary.failedTests.map((t) => t.title);
    expect(titles).toContain("describe > test fullName only");
    expect(titles).toContain("name-only");
    expect(titles).toContain("uuid-no-titles");
  });
});
