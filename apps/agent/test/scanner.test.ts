import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanProject, ProjectScanError } from "../src/project/scanner.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-scan-")));
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(path.join(workdir, file), JSON.stringify(data));
}

function touch(file: string, contents = ""): void {
  fs.mkdirSync(path.dirname(path.join(workdir, file)), { recursive: true });
  fs.writeFileSync(path.join(workdir, file), contents);
}

describe("scanProject", () => {
  it("rejects non-existent project root", async () => {
    await expect(
      scanProject({ rootPath: path.join(workdir, "missing") })
    ).rejects.toBeInstanceOf(ProjectScanError);
  });

  it("rejects project root outside the allowed list", async () => {
    writeJson("package.json", { devDependencies: { "@playwright/test": "^1" } });
    await expect(
      scanProject({
        rootPath: workdir,
        allowedRoots: [path.join(os.tmpdir(), "definitely-not-here")]
      })
    ).rejects.toThrow(/not in the allowed/);
  });

  it("scans a valid pnpm project", async () => {
    writeJson("package.json", {
      packageManager: "pnpm@10.8.0",
      devDependencies: { "@playwright/test": "^1.55.0" }
    });
    touch("pnpm-lock.yaml");
    touch("playwright.config.ts");
    touch("node_modules/.bin/playwright");
    const { summary, packageManager } = await scanProject({ rootPath: workdir });
    expect(summary.rootPath).toBe(workdir);
    expect(packageManager.name).toBe("pnpm");
    expect(packageManager.blockingExecution).toBe(false);
    expect(summary.playwrightConfigPath).toMatch(/playwright\.config\.ts$/);
  });

  it("blocks execution when @playwright/test is not in dependencies", async () => {
    writeJson("package.json", { devDependencies: {} });
    touch("package-lock.json");
    const { summary } = await scanProject({ rootPath: workdir });
    expect(summary.blockingExecution).toBe(true);
  });

  it("flags ambiguous lockfiles", async () => {
    writeJson("package.json", {
      devDependencies: { "@playwright/test": "^1.55.0" }
    });
    touch("package-lock.json");
    touch("pnpm-lock.yaml");
    const { summary, packageManager } = await scanProject({ rootPath: workdir });
    expect(packageManager.status).toBe("ambiguous-lockfiles");
    expect(summary.blockingExecution).toBe(true);
  });

  it("detects allure-playwright presence", async () => {
    writeJson("package.json", {
      devDependencies: {
        "@playwright/test": "^1.55.0",
        "allure-playwright": "^3.0.0"
      }
    });
    touch("pnpm-lock.yaml");
    touch("node_modules/.bin/playwright");
    const { summary } = await scanProject({ rootPath: workdir });
    expect(summary.hasAllurePlaywright).toBe(true);
  });

  describe("Allure CLI detection (Allure 3 + Allure 2 backward-compat)", () => {
    it("detects Allure 3 CLI by `allure` package", async () => {
      writeJson("package.json", {
        devDependencies: {
          "@playwright/test": "^1.55.0",
          allure: "~3.6.2"
        }
      });
      touch("pnpm-lock.yaml");
      touch("node_modules/.bin/playwright");
      const { summary } = await scanProject({ rootPath: workdir });
      expect(summary.hasAllureCli).toBe(true);
    });

    it("detects Allure 2 CLI by `allure-commandline` package (backward-compat)", async () => {
      writeJson("package.json", {
        devDependencies: {
          "@playwright/test": "^1.55.0",
          "allure-commandline": "^2.30.0"
        }
      });
      touch("pnpm-lock.yaml");
      touch("node_modules/.bin/playwright");
      const { summary } = await scanProject({ rootPath: workdir });
      expect(summary.hasAllureCli).toBe(true);
    });

    it("returns hasAllureCli=false when neither Allure CLI is installed", async () => {
      writeJson("package.json", {
        devDependencies: { "@playwright/test": "^1.55.0" }
      });
      touch("pnpm-lock.yaml");
      touch("node_modules/.bin/playwright");
      const { summary } = await scanProject({ rootPath: workdir });
      expect(summary.hasAllureCli).toBe(false);
    });
  });

  describe("allure-playwright resultsDir detection (T203-1)", () => {
    function setupBasicProject(configContents: string): void {
      writeJson("package.json", {
        devDependencies: {
          "@playwright/test": "^1.55.0",
          "allure-playwright": "^3.7.1"
        }
      });
      touch("pnpm-lock.yaml");
      touch("node_modules/.bin/playwright");
      touch("playwright.config.ts", configContents);
    }

    it("extracts resultsDir from a static double-quoted literal", async () => {
      setupBasicProject(`
        export default {
          reporter: [
            ["list"],
            ["allure-playwright", { resultsDir: "allure-results" }]
          ]
        };
      `);
      const { summary } = await scanProject({ rootPath: workdir });
      expect(summary.allureResultsDir).toBe("allure-results");
      expect(summary.warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining("dynamic")])
      );
    });

    it("extracts resultsDir from a static single-quoted literal", async () => {
      setupBasicProject(`
        export default {
          reporter: [
            ['allure-playwright', { resultsDir: 'foo/bar' }]
          ]
        };
      `);
      const { summary } = await scanProject({ rootPath: workdir });
      expect(summary.allureResultsDir).toBe("foo/bar");
    });

    it("emits a warning when reporter is referenced but resultsDir is missing/dynamic", async () => {
      setupBasicProject(`
        const dir = someDynamic();
        export default {
          reporter: [
            ["allure-playwright", { resultsDir: dir }]
          ]
        };
      `);
      const { summary } = await scanProject({ rootPath: workdir });
      expect(summary.allureResultsDir).toBeUndefined();
      expect(summary.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("dynamic"),
        ])
      );
    });

    it("does not warn or set resultsDir when allure-playwright is not used at all", async () => {
      setupBasicProject(`
        export default {
          reporter: [["list"]]
        };
      `);
      const { summary } = await scanProject({ rootPath: workdir });
      expect(summary.allureResultsDir).toBeUndefined();
      expect(summary.warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining("allure")])
      );
    });

    it("rejects an absolute resultsDir path", async () => {
      setupBasicProject(`
        export default {
          reporter: [["allure-playwright", { resultsDir: "/tmp/results" }]]
        };
      `);
      const { summary } = await scanProject({ rootPath: workdir });
      expect(summary.allureResultsDir).toBeUndefined();
      expect(summary.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("absolute path"),
        ])
      );
    });

    it("rejects path traversal in resultsDir", async () => {
      setupBasicProject(`
        export default {
          reporter: [["allure-playwright", { resultsDir: "../escape" }]]
        };
      `);
      const { summary } = await scanProject({ rootPath: workdir });
      expect(summary.allureResultsDir).toBeUndefined();
      expect(summary.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("path traversal"),
        ])
      );
    });

    it("rejects Windows-drive path in resultsDir", async () => {
      setupBasicProject(`
        export default {
          reporter: [["allure-playwright", { resultsDir: "C:\\\\results" }]]
        };
      `);
      const { summary } = await scanProject({ rootPath: workdir });
      // Windows-drive path uses a backslash-escaped char in JS, which the
      // regex's `[^'"\\]+` rejects entirely. The detector should NOT extract
      // a value (regex no-match treated as "missing/dynamic" → warning).
      expect(summary.allureResultsDir).toBeUndefined();
      expect(summary.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("dynamic"),
        ])
      );
    });

    it("emits a warning when reporter is referenced as a bare string (no options object)", async () => {
      setupBasicProject(`
        export default {
          reporter: "allure-playwright"
        };
      `);
      const { summary } = await scanProject({ rootPath: workdir });
      // Bare string form has no resultsDir to extract; warning lets the
      // run pipeline know to fall back to the default.
      expect(summary.allureResultsDir).toBeUndefined();
      expect(summary.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("missing or dynamic"),
        ])
      );
    });
  });
});
