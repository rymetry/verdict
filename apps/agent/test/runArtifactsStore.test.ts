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

  it("re-throws non-ENOENT filesystem errors", async () => {
    // Reading a directory as if it were a file produces EISDIR. This deterministically
    // exercises the non-ENOENT re-throw path on every platform without relying on
    // permission semantics (which differ for root in CI containers).
    const dirAsFile = path.join(workdir, "results.json");
    fs.mkdirSync(dirAsFile);
    await expect(
      runArtifactsStore.redactPlaywrightResults(dirAsFile)
    ).rejects.toMatchObject({ code: "EISDIR" });
  });
});

/* ---------------------------------------------------------------- */
/* T203-2: Allure detect/archive/copy lifecycle helpers              */
/* ---------------------------------------------------------------- */

describe("runArtifactsStore.archiveAllureResultsDir", () => {
  it("returns archived=false when source dir is absent (no previous run)", async () => {
    const sourceAbs = path.join(workdir, "allure-results");
    const outcome = await runArtifactsStore.archiveAllureResultsDir(workdir, sourceAbs);
    expect(outcome.archived).toBe(false);
    expect(outcome.archivePath).toBeUndefined();
    expect(outcome.warnings).toEqual([]);
  });

  it("returns archived=false when source dir is empty", async () => {
    const sourceAbs = path.join(workdir, "allure-results");
    fs.mkdirSync(sourceAbs);
    const outcome = await runArtifactsStore.archiveAllureResultsDir(workdir, sourceAbs);
    expect(outcome.archived).toBe(false);
    expect(outcome.archivePath).toBeUndefined();
    expect(outcome.warnings).toEqual([]);
  });

  it("warns when source path is a regular file rather than a directory", async () => {
    const sourceAbs = path.join(workdir, "allure-results");
    fs.writeFileSync(sourceAbs, "not a directory");
    const outcome = await runArtifactsStore.archiveAllureResultsDir(workdir, sourceAbs);
    expect(outcome.archived).toBe(false);
    expect(outcome.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("not a directory")])
    );
  });

  it("refuses to archive when source itself is a symlink (path-redaction policy)", async () => {
    const sourceTarget = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-allure-target-")));
    const sourceAbs = path.join(workdir, "allure-results");
    try {
      fs.symlinkSync(sourceTarget, sourceAbs);
      const outcome = await runArtifactsStore.archiveAllureResultsDir(workdir, sourceAbs);
      expect(outcome.archived).toBe(false);
      expect(outcome.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("symlink")])
      );
      // Target dir should not have been touched (no archive happened)
      expect(fs.existsSync(sourceTarget)).toBe(true);
    } finally {
      fs.rmSync(sourceTarget, { recursive: true, force: true });
    }
  });

  it("moves all entries from source to a fresh timestamped subdir under archiveDir", async () => {
    const sourceAbs = path.join(workdir, "allure-results");
    fs.mkdirSync(sourceAbs);
    fs.writeFileSync(path.join(sourceAbs, "uuid-a-result.json"), "{}");
    fs.writeFileSync(path.join(sourceAbs, "uuid-b-result.json"), "{}");
    fs.mkdirSync(path.join(sourceAbs, "subdir"));
    fs.writeFileSync(path.join(sourceAbs, "subdir/inner.txt"), "x");

    const outcome = await runArtifactsStore.archiveAllureResultsDir(workdir, sourceAbs);
    expect(outcome.archived).toBe(true);
    expect(outcome.archivePath).toMatch(/\.playwright-workbench[\\/]archive[\\/]/);

    // Source should now be empty (entries moved).
    expect(fs.readdirSync(sourceAbs)).toEqual([]);

    // Archive should hold the moved entries.
    const archived = fs.readdirSync(outcome.archivePath!);
    expect(archived.sort()).toEqual(["subdir", "uuid-a-result.json", "uuid-b-result.json"]);
    expect(fs.readdirSync(path.join(outcome.archivePath!, "subdir"))).toEqual(["inner.txt"]);
  });

  it("skips symlink entries inside source with a warning, but moves non-symlink siblings", async () => {
    const sourceAbs = path.join(workdir, "allure-results");
    fs.mkdirSync(sourceAbs);
    fs.writeFileSync(path.join(sourceAbs, "uuid-real-result.json"), "{}");
    // A symlink inside source: must not be archived.
    fs.symlinkSync("/etc/passwd", path.join(sourceAbs, "evil-link"));

    const outcome = await runArtifactsStore.archiveAllureResultsDir(workdir, sourceAbs);
    expect(outcome.archived).toBe(true);
    expect(outcome.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("symlink")])
    );
    // Real file moved; symlink still in source (not archived, not destroyed).
    expect(fs.readdirSync(outcome.archivePath!)).toEqual(["uuid-real-result.json"]);
    expect(fs.readdirSync(sourceAbs)).toEqual(["evil-link"]);
  });

  it("creates archiveDir parent on demand (first archive ever)", async () => {
    // Ensure .playwright-workbench/archive does NOT exist yet.
    const sourceAbs = path.join(workdir, "allure-results");
    fs.mkdirSync(sourceAbs);
    fs.writeFileSync(path.join(sourceAbs, "x-result.json"), "{}");

    const outcome = await runArtifactsStore.archiveAllureResultsDir(workdir, sourceAbs);
    expect(outcome.archived).toBe(true);
    expect(fs.existsSync(path.join(workdir, ".playwright-workbench", "archive"))).toBe(true);
  });
});

describe("runArtifactsStore.copyAllureResultsDir", () => {
  it("returns copied=false when source is absent", async () => {
    const sourceAbs = path.join(workdir, "allure-results");
    const destAbs = path.join(workdir, "runs", "abc", "allure-results");
    const outcome = await runArtifactsStore.copyAllureResultsDir(sourceAbs, destAbs);
    expect(outcome.copied).toBe(false);
    expect(outcome.fileCount).toBe(0);
    expect(outcome.warnings).toEqual([]);
  });

  it("returns copied=false when source is empty", async () => {
    const sourceAbs = path.join(workdir, "allure-results");
    fs.mkdirSync(sourceAbs);
    const destAbs = path.join(workdir, "runs", "abc", "allure-results");
    const outcome = await runArtifactsStore.copyAllureResultsDir(sourceAbs, destAbs);
    expect(outcome.copied).toBe(false);
    expect(outcome.fileCount).toBe(0);
  });

  it("copies regular files from source to dest (recursive), source preserved", async () => {
    const sourceAbs = path.join(workdir, "allure-results");
    fs.mkdirSync(sourceAbs);
    fs.writeFileSync(path.join(sourceAbs, "uuid-a-result.json"), "alpha");
    fs.mkdirSync(path.join(sourceAbs, "nested"));
    fs.writeFileSync(path.join(sourceAbs, "nested/inner.txt"), "beta");

    const destAbs = path.join(workdir, "runs", "abc", "allure-results");
    const outcome = await runArtifactsStore.copyAllureResultsDir(sourceAbs, destAbs);
    expect(outcome.copied).toBe(true);
    expect(outcome.fileCount).toBe(2);

    // Source untouched (copy, not move).
    expect(fs.readFileSync(path.join(sourceAbs, "uuid-a-result.json"), "utf8")).toBe("alpha");
    expect(fs.readFileSync(path.join(sourceAbs, "nested/inner.txt"), "utf8")).toBe("beta");

    // Dest holds copies.
    expect(fs.readFileSync(path.join(destAbs, "uuid-a-result.json"), "utf8")).toBe("alpha");
    expect(fs.readFileSync(path.join(destAbs, "nested/inner.txt"), "utf8")).toBe("beta");
  });

  it("skips symlink entries inside source with a warning", async () => {
    const sourceAbs = path.join(workdir, "allure-results");
    fs.mkdirSync(sourceAbs);
    fs.writeFileSync(path.join(sourceAbs, "real-result.json"), "ok");
    fs.symlinkSync("/etc/passwd", path.join(sourceAbs, "evil-link"));

    const destAbs = path.join(workdir, "runs", "abc", "allure-results");
    const outcome = await runArtifactsStore.copyAllureResultsDir(sourceAbs, destAbs);
    expect(outcome.copied).toBe(true);
    expect(outcome.fileCount).toBe(1);
    expect(outcome.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("symlink")])
    );
    // Symlink should NOT have been recreated in dest.
    expect(fs.readdirSync(destAbs)).toEqual(["real-result.json"]);
  });

  it("creates dest parent directories on demand", async () => {
    const sourceAbs = path.join(workdir, "allure-results");
    fs.mkdirSync(sourceAbs);
    fs.writeFileSync(path.join(sourceAbs, "x-result.json"), "{}");

    // Note: the dest parent (`runs/abc/`) does not exist yet.
    const destAbs = path.join(workdir, "runs", "abc", "allure-results");
    const outcome = await runArtifactsStore.copyAllureResultsDir(sourceAbs, destAbs);
    expect(outcome.copied).toBe(true);
    expect(fs.existsSync(destAbs)).toBe(true);
  });

  it("warns when source path is a symlink to a directory", async () => {
    const sourceTarget = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-allure-cp-target-")));
    fs.writeFileSync(path.join(sourceTarget, "x-result.json"), "{}");
    const sourceAbs = path.join(workdir, "allure-results");
    try {
      fs.symlinkSync(sourceTarget, sourceAbs);
      const destAbs = path.join(workdir, "runs", "abc", "allure-results");
      const outcome = await runArtifactsStore.copyAllureResultsDir(sourceAbs, destAbs);
      expect(outcome.copied).toBe(false);
      expect(outcome.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining("symlink")])
      );
    } finally {
      fs.rmSync(sourceTarget, { recursive: true, force: true });
    }
  });
});
