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
});
