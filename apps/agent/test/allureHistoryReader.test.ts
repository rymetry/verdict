import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAllureHistory } from "../src/reporting/allureHistoryReader.js";

let workdir: string;
let historyPath: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-history-")));
  historyPath = path.join(workdir, "allure-history.jsonl");
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("readAllureHistory", () => {
  it("returns empty result with no warning when the file is missing", async () => {
    const result = await readAllureHistory(historyPath);
    expect(result).toEqual({ entries: [], warnings: [] });
  });

  it("parses a single valid JSONL line", async () => {
    fs.writeFileSync(
      historyPath,
      JSON.stringify({
        generatedAt: "2026-04-30T12:00:00Z",
        total: 5,
        passed: 4,
        failed: 1,
      }) + "\n"
    );
    const result = await readAllureHistory(historyPath);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.passed).toBe(4);
    expect(result.warnings).toEqual([]);
  });

  it("parses multiple lines and ignores blank ones", async () => {
    fs.writeFileSync(
      historyPath,
      [
        JSON.stringify({ generatedAt: "2026-04-30T12:00:00Z", total: 5 }),
        "",
        JSON.stringify({ generatedAt: "2026-04-30T12:01:00Z", total: 6 }),
        "",
      ].join("\n")
    );
    const result = await readAllureHistory(historyPath);
    expect(result.entries).toHaveLength(2);
  });

  it("warns and skips a line that is not valid JSON", async () => {
    fs.writeFileSync(
      historyPath,
      JSON.stringify({ generatedAt: "2026-04-30T12:00:00Z" }) +
        "\n{ not valid json\n"
    );
    const result = await readAllureHistory(historyPath);
    expect(result.entries).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("not valid JSON"))).toBe(true);
  });

  it("warns and skips a line missing required generatedAt", async () => {
    fs.writeFileSync(
      historyPath,
      JSON.stringify({ total: 5 }) + "\n"
    );
    const result = await readAllureHistory(historyPath);
    expect(result.entries).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/did not match schema/);
  });

  it("normalizes Allure 3.6 timestamp/testResults history entries", async () => {
    fs.writeFileSync(
      historyPath,
      JSON.stringify({
        timestamp: 1777550091866,
        testResults: {
          a: { status: "passed" },
          b: { status: "failed" },
          c: { status: "broken" },
          d: { status: "skipped" }
        }
      }) + "\n"
    );
    const result = await readAllureHistory(historyPath);
    expect(result.warnings).toEqual([]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.generatedAt).toBe("2026-04-30T11:54:51.866Z");
    expect(result.entries[0]?.total).toBe(4);
    expect(result.entries[0]?.passed).toBe(1);
    expect(result.entries[0]?.failed).toBe(2);
    expect(result.entries[0]?.skipped).toBe(1);
  });

  it("preserves additional fields via passthrough", async () => {
    fs.writeFileSync(
      historyPath,
      JSON.stringify({
        generatedAt: "2026-04-30T12:00:00Z",
        total: 5,
        unknownVendorField: { foo: "bar" },
      }) + "\n"
    );
    const result = await readAllureHistory(historyPath);
    expect((result.entries[0] as Record<string, unknown>).unknownVendorField).toEqual({
      foo: "bar",
    });
  });

  it("returns a warning when the file exceeds the size cap", async () => {
    // Create a file just over the cap by writing a single huge JSON object.
    const big = "x".repeat(17 * 1024 * 1024);
    fs.writeFileSync(historyPath, `{"generatedAt":"2026-04-30T12:00:00Z","_pad":"${big}"}\n`);
    const result = await readAllureHistory(historyPath);
    expect(result.entries).toEqual([]);
    expect(result.warnings[0]).toMatch(/exceeds/);
  });
});
