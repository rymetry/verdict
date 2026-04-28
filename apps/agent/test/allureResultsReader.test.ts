import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAllureResults } from "../src/reporting/allureResultsReader.js";

// Direct reader-level tests for behaviors not easily exercised through the
// AllureReportProvider integration tests:
//   - Process-level read errors (EACCES) propagate, not skip-and-warn
//   - readdir ENOENT propagates with the documented caller-redaction contract
//
// Most provider behavior is covered by allureReportProvider.test.ts; this
// file targets the reader's low-level error-handling contract directly so
// future refactors of FATAL_READ_CODES are detectable at the reader layer.

let workdir: string;
let allureResultsDir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-allure-reader-")));
  allureResultsDir = path.join(workdir, "allure-results");
  fs.mkdirSync(allureResultsDir, { recursive: true });
});

afterEach(() => {
  // Restore permissions on any chmod-locked files before deletion so the
  // afterEach cleanup itself does not error out on Linux/macOS.
  try {
    const entries = fs.readdirSync(allureResultsDir);
    for (const entry of entries) {
      try {
        fs.chmodSync(path.join(allureResultsDir, entry), 0o644);
      } catch {
        // best-effort
      }
    }
  } catch {
    // dir might already be gone
  }
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("readAllureResults — error propagation contract", () => {
  it("propagates ENOENT from readdir (caller redacts via errorLogFields)", async () => {
    fs.rmSync(allureResultsDir, { recursive: true, force: true });
    await expect(readAllureResults(allureResultsDir)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("returns empty result/warnings for an empty directory", async () => {
    const result = await readAllureResults(allureResultsDir);
    expect(result.results).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("propagates EACCES (process-level read failure) instead of skip-and-warn", async () => {
    // Skip on Windows / non-POSIX where chmod semantics differ.
    if (process.platform === "win32") {
      return;
    }
    // Skip when running as root (chmod 000 has no effect on root reads).
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      return;
    }

    const lockedFile = path.join(allureResultsDir, "uuid-locked-result.json");
    fs.writeFileSync(
      lockedFile,
      JSON.stringify({ uuid: "uuid-locked", status: "passed" })
    );
    fs.chmodSync(lockedFile, 0o000);

    // Reader must throw (FATAL_READ_CODES set) rather than swallow into
    // warnings. This is the load-bearing distinction for the silent-failure
    // policy — flooding warnings on FD/permission exhaustion masks the
    // operator-action condition that the run-pipeline log surfaces once.
    await expect(readAllureResults(allureResultsDir)).rejects.toMatchObject({
      code: "EACCES",
    });
  });

  it("does NOT propagate per-file content errors (malformed JSON, schema mismatch)", async () => {
    // Two files: one valid, one malformed. Reader must continue processing
    // the valid file even though the malformed one fails. This is the
    // opposite of the FATAL_READ_CODES policy — content errors are
    // best-effort, process-level errors are fatal.
    fs.writeFileSync(
      path.join(allureResultsDir, "uuid-good-result.json"),
      JSON.stringify({
        uuid: "uuid-good",
        status: "passed",
        start: 0,
        stop: 10,
      })
    );
    fs.writeFileSync(
      path.join(allureResultsDir, "uuid-bad-result.json"),
      "{ malformed json"
    );

    const result = await readAllureResults(allureResultsDir);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.uuid).toBe("uuid-good");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("uuid-bad-result.json");
    expect(result.warnings[0]).toContain("not valid JSON");
  });
});
