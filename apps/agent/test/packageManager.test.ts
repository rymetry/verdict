import { describe, expect, it } from "vitest";
import { detectPackageManager } from "../src/project/packageManager.js";

const baseInput = {
  projectRoot: "/tmp/example",
  packageJson: {
    devDependencies: {
      "@playwright/test": "^1.55.0"
    }
  },
  hasYarnPnP: false,
  hasPlaywrightBinInNodeModules: true
};

describe("detectPackageManager", () => {
  it("uses package.json#packageManager when present", () => {
    const result = detectPackageManager({
      ...baseInput,
      packageJson: { ...baseInput.packageJson, packageManager: "pnpm@10.8.0" },
      lockfiles: ["pnpm-lock.yaml"]
    });
    expect(result.name).toBe("pnpm");
    expect(result.status).toBe("ok");
    expect(result.confidence).toBe("high");
    expect(result.commandTemplates.playwrightTest.executable).toBe("pnpm");
    expect(result.commandTemplates.playwrightTest.args).toEqual(["exec", "playwright", "test"]);
    expect(result.blockingExecution).toBe(false);
  });

  it("warns when packageManager and lockfile disagree", () => {
    const result = detectPackageManager({
      ...baseInput,
      packageJson: { ...baseInput.packageJson, packageManager: "pnpm@10.8.0" },
      lockfiles: ["yarn.lock"]
    });
    expect(result.name).toBe("pnpm");
    expect(result.warnings.some((w) => w.includes("yarn"))).toBe(true);
  });

  it("infers single lockfile", () => {
    const result = detectPackageManager({
      ...baseInput,
      lockfiles: ["package-lock.json"]
    });
    expect(result.name).toBe("npm");
    expect(result.status).toBe("ok");
    expect(result.commandTemplates.playwrightTest.args[0]).toBe("--no-install");
  });

  it("blocks ambiguous lockfiles", () => {
    const result = detectPackageManager({
      ...baseInput,
      lockfiles: ["package-lock.json", "pnpm-lock.yaml"]
    });
    expect(result.status).toBe("ambiguous-lockfiles");
    expect(result.blockingExecution).toBe(true);
    expect(result.errors.some((e) => e.toLowerCase().includes("ambiguous"))).toBe(true);
  });

  it("falls back to npm with warning when no lockfile", () => {
    const result = detectPackageManager({
      ...baseInput,
      lockfiles: []
    });
    expect(result.name).toBe("npm");
    expect(result.status).toBe("no-lockfile-fallback");
    expect(result.warnings.some((w) => w.toLowerCase().includes("no lockfile"))).toBe(true);
  });

  it("blocks Bun as experimental even when bun.lock detected", () => {
    const result = detectPackageManager({
      ...baseInput,
      lockfiles: ["bun.lock"],
      hasPlaywrightBinInNodeModules: false
    });
    expect(result.name).toBe("bun");
    expect(result.status).toBe("experimental-bun");
    expect(result.blockingExecution).toBe(true);
    expect(result.commandTemplates.playwrightTest.args).toContain("--no-install");
    expect(result.commandTemplates.playwrightTest.args).toContain("--bun");
  });

  it("flags Yarn PnP local binary as usable", () => {
    const result = detectPackageManager({
      ...baseInput,
      lockfiles: ["yarn.lock"],
      hasPlaywrightBinInNodeModules: false,
      hasYarnPnP: true
    });
    expect(result.name).toBe("yarn");
    expect(result.localBinaryUsable).toBe(true);
    expect(result.blockingExecution).toBe(false);
  });

  it("blocks execution when @playwright/test is missing", () => {
    const result = detectPackageManager({
      ...baseInput,
      packageJson: { devDependencies: {} },
      lockfiles: ["package-lock.json"]
    });
    expect(result.hasPlaywrightDevDependency).toBe(false);
    expect(result.blockingExecution).toBe(true);
    expect(result.errors.some((e) => e.includes("@playwright/test"))).toBe(true);
  });

  it("respects override", () => {
    const result = detectPackageManager({
      ...baseInput,
      lockfiles: ["pnpm-lock.yaml"],
      override: "yarn",
      hasYarnPnP: true,
      hasPlaywrightBinInNodeModules: false
    });
    expect(result.name).toBe("yarn");
    expect(result.confidence).toBe("high");
    expect(result.reason.toLowerCase()).toContain("override");
  });

  it("warns when npm local bin missing", () => {
    const result = detectPackageManager({
      ...baseInput,
      lockfiles: ["package-lock.json"],
      hasPlaywrightBinInNodeModules: false
    });
    expect(result.localBinaryUsable).toBe(false);
    expect(result.blockingExecution).toBe(true);
    expect(result.warnings.some((w) => w.toLowerCase().includes("--no-install"))).toBe(true);
  });
});
