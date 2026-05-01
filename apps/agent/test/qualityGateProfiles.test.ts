import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultRulesForProfile,
  loadQualityGateProfileConfig,
  QUALITY_GATE_PROFILE_CONFIG_REL,
  resolveQualityGateRules,
} from "../src/playwright/qualityGateProfiles.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-qg-prof-")));
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function writeConfig(contents: string): void {
  const file = path.join(workdir, QUALITY_GATE_PROFILE_CONFIG_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

describe("defaultRulesForProfile", () => {
  it("local-review requires zero failures and a configured minimum test count", () => {
    expect(defaultRulesForProfile("local-review")).toEqual({
      maxFailures: 0,
      minTestsCount: 1
    });
  });

  it("release-smoke is zero-tolerance + fast-fail", () => {
    expect(defaultRulesForProfile("release-smoke")).toEqual({
      maxFailures: 0,
      successRate: 100,
      fastFail: true,
    });
  });

  it("full-regression caps successRate at 95%", () => {
    expect(defaultRulesForProfile("full-regression")).toEqual({ successRate: 95 });
  });
});

describe("loadQualityGateProfileConfig", () => {
  it("returns no warnings + undefined when the override file is absent", async () => {
    const result = await loadQualityGateProfileConfig(workdir);
    expect(result).toEqual({ warnings: [] });
  });

  it("parses a valid config with overrides for one profile", async () => {
    writeConfig(JSON.stringify({ "release-smoke": { successRate: 99 } }));
    const result = await loadQualityGateProfileConfig(workdir);
    expect(result.warnings).toEqual([]);
    expect(result.config?.["release-smoke"]?.successRate).toBe(99);
  });

  it("warns and ignores a malformed JSON file", async () => {
    writeConfig("{ not valid json");
    const result = await loadQualityGateProfileConfig(workdir);
    expect(result.config).toBeUndefined();
    expect(result.warnings[0]).toMatch(/not valid JSON/);
  });

  it("warns when the schema rejects unknown profile keys", async () => {
    writeConfig(JSON.stringify({ "made-up-profile": { successRate: 50 } }));
    const result = await loadQualityGateProfileConfig(workdir);
    expect(result.config).toBeUndefined();
    expect(result.warnings[0]).toMatch(/unexpected shape/);
  });

  it("warns when successRate is out of range", async () => {
    writeConfig(JSON.stringify({ "release-smoke": { successRate: 200 } }));
    const result = await loadQualityGateProfileConfig(workdir);
    expect(result.warnings[0]).toMatch(/unexpected shape/);
  });

  it("warns when the override file is oversized", async () => {
    const big = "x".repeat(70_000);
    writeConfig(`{"release-smoke": {"_padding": "${big}"}}`);
    const result = await loadQualityGateProfileConfig(workdir);
    expect(result.warnings[0]).toMatch(/exceeds/);
  });
});

describe("resolveQualityGateRules", () => {
  it("returns the built-in defaults when the override file is absent", async () => {
    const resolved = await resolveQualityGateRules(workdir, "release-smoke");
    expect(resolved.profile).toBe("release-smoke");
    expect(resolved.rules).toEqual({
      maxFailures: 0,
      successRate: 100,
      fastFail: true,
    });
    expect(resolved.warnings).toEqual([]);
  });

  it("merges override fields on top of built-in defaults (override wins)", async () => {
    writeConfig(JSON.stringify({ "release-smoke": { successRate: 99 } }));
    const resolved = await resolveQualityGateRules(workdir, "release-smoke");
    expect(resolved.rules).toEqual({
      maxFailures: 0, // from built-in
      successRate: 99, // overridden
      fastFail: true, // from built-in
    });
  });

  it("falls through to built-in when the requested profile is not in the override file", async () => {
    writeConfig(JSON.stringify({ "release-smoke": { successRate: 99 } }));
    const resolved = await resolveQualityGateRules(workdir, "full-regression");
    expect(resolved.rules).toEqual({ successRate: 95 });
  });

  it("propagates parse warnings while still returning built-in defaults", async () => {
    writeConfig("not json");
    const resolved = await resolveQualityGateRules(workdir, "local-review");
    expect(resolved.rules).toEqual({ maxFailures: 0, minTestsCount: 1 });
    expect(resolved.warnings[0]).toMatch(/not valid JSON/);
  });
});
