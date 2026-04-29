import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildQmoSummary,
  persistQmoSummary,
  readPersistedQualityGate,
  renderQmoSummaryMarkdown
} from "../src/reporting/qmoSummary.js";
import type { QualityGateResult, RunMetadata, TestResultSummary } from "@pwqa/shared";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-qmo-")));
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function makeMetadata(overrides: Partial<RunMetadata> = {}): RunMetadata {
  const baseSummary: TestResultSummary = {
    total: 2,
    passed: 2,
    failed: 0,
    skipped: 0,
    flaky: 0,
    failedTests: []
  };
  return {
    runId: "run-1",
    projectId: "/p",
    projectRoot: "/p",
    status: "passed",
    startedAt: "2026-04-29T00:00:00Z",
    completedAt: "2026-04-29T00:01:00Z",
    command: { executable: "npx", args: ["playwright", "test"] },
    cwd: "/p",
    requested: { projectId: "/p", headed: false },
    paths: {
      runDir: "/runs/run-1",
      metadataJson: "/runs/run-1/metadata.json",
      stdoutLog: "/runs/run-1/stdout.log",
      stderrLog: "/runs/run-1/stderr.log",
      playwrightJson: "/runs/run-1/playwright-results.json",
      playwrightHtml: "/runs/run-1/playwright-report",
      artifactsJson: "/runs/run-1/artifacts.json",
      allureResultsDest: "/runs/run-1/allure-results",
      allureReportDir: "/runs/run-1/allure-report",
      qualityGateResultPath: "/runs/run-1/quality-gate-result.json",
      qmoSummaryJsonPath: "/runs/run-1/qmo-summary.json",
      qmoSummaryMarkdownPath: "/runs/run-1/qmo-summary.md"
    },
    summary: baseSummary,
    warnings: [],
    durationMs: 60_000,
    exitCode: 0,
    signal: null,
    ...overrides
  };
}

describe("buildQmoSummary outcome derivation", () => {
  it("returns 'ready' when all tests pass and no quality gate result", () => {
    const summary = buildQmoSummary({ runMetadata: makeMetadata() });
    expect(summary.outcome).toBe("ready");
    expect(summary.qualityGate).toBeUndefined();
  });

  it("returns 'ready' when tests pass and QG passed without warnings", () => {
    const qg: QualityGateResult = {
      status: "passed",
      profile: "local-review",
      evaluatedAt: "2026-04-29T00:01:30Z",
      exitCode: 0,
      stdout: "passed",
      stderr: "",
      warnings: []
    };
    const summary = buildQmoSummary({ runMetadata: makeMetadata(), qualityGateResult: qg });
    expect(summary.outcome).toBe("ready");
    expect(summary.qualityGate?.status).toBe("passed");
  });

  it("returns 'not-ready' when any test failed", () => {
    const md = makeMetadata({
      summary: {
        total: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        flaky: 0,
        failedTests: [
          {
            title: "broken",
            fullTitle: "suite > broken",
            status: "failed",
            attachments: []
          }
        ]
      }
    });
    expect(buildQmoSummary({ runMetadata: md }).outcome).toBe("not-ready");
  });

  it("returns 'not-ready' when QG failed (even if tests pass)", () => {
    const qg: QualityGateResult = {
      status: "failed",
      profile: "release-smoke",
      evaluatedAt: "2026-04-29T00:01:30Z",
      exitCode: 1,
      stdout: "",
      stderr: "violated",
      warnings: []
    };
    expect(
      buildQmoSummary({ runMetadata: makeMetadata(), qualityGateResult: qg }).outcome
    ).toBe("not-ready");
  });

  it("returns 'not-ready' when QG errored", () => {
    const qg: QualityGateResult = {
      status: "error",
      profile: "local-review",
      evaluatedAt: "2026-04-29T00:01:30Z",
      exitCode: 2,
      stdout: "",
      stderr: "internal",
      warnings: ["unexpected exit code"]
    };
    expect(
      buildQmoSummary({ runMetadata: makeMetadata(), qualityGateResult: qg }).outcome
    ).toBe("not-ready");
  });

  it("returns 'conditional' when tests pass but QG was skipped with warnings (binary missing during a results-bearing run)", () => {
    const qg: QualityGateResult = {
      status: "skipped",
      profile: "local-review",
      evaluatedAt: "2026-04-29T00:01:30Z",
      exitCode: null,
      stdout: "",
      stderr: "",
      warnings: ["Allure CLI not found at <projectRoot>/..."]
    };
    expect(
      buildQmoSummary({ runMetadata: makeMetadata(), qualityGateResult: qg }).outcome
    ).toBe("conditional");
  });

  it("returns 'conditional' when QG passed but had soft warnings", () => {
    const qg: QualityGateResult = {
      status: "passed",
      profile: "local-review",
      evaluatedAt: "2026-04-29T00:01:30Z",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      warnings: ["Test count below recommended threshold"]
    };
    expect(
      buildQmoSummary({ runMetadata: makeMetadata(), qualityGateResult: qg }).outcome
    ).toBe("conditional");
  });
});

describe("buildQmoSummary content", () => {
  it("includes test summary, run command, and warnings", () => {
    const md = makeMetadata({
      warnings: ["disk space low"],
      durationMs: 12_345
    });
    const qg: QualityGateResult = {
      status: "passed",
      profile: "local-review",
      evaluatedAt: "2026-04-29T00:01:30Z",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      warnings: []
    };
    const summary = buildQmoSummary({ runMetadata: md, qualityGateResult: qg });
    expect(summary.runId).toBe("run-1");
    expect(summary.projectId).toBe("/p");
    expect(summary.testSummary?.total).toBe(2);
    expect(summary.warnings).toEqual(["disk space low"]);
    expect(summary.runDurationMs).toBe(12_345);
    expect(summary.command?.executable).toBe("npx");
    // reportLinks are gated on actual artifact presence (T207 review fix);
    // when no skip/failure markers are in the warnings, both links populate.
    expect(summary.reportLinks.allureReportDir).toBe("/runs/run-1/allure-report");
    expect(summary.reportLinks.qualityGateResultPath).toBe("/runs/run-1/quality-gate-result.json");
  });
});

describe("renderQmoSummaryMarkdown", () => {
  it("emits a stable header structure with outcome, run, project, generated", () => {
    const summary = buildQmoSummary({ runMetadata: makeMetadata() });
    const md = renderQmoSummaryMarkdown(summary);
    expect(md).toContain("# QMO Release Readiness Summary");
    expect(md).toContain("**Outcome**: `ready`");
    expect(md).toContain("**Run**: `run-1`");
    expect(md).toContain("**Project**: `/p`");
    expect(md).toContain("## Test Summary");
    expect(md).toContain("## Quality Gate");
    expect(md).toContain("_Quality gate not evaluated for this run._");
    expect(md).toContain("## Artifacts");
  });

  it("renders the failed-tests subsection when failures are present", () => {
    const md = makeMetadata({
      summary: {
        total: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        flaky: 0,
        failedTests: [
          {
            title: "broken",
            fullTitle: "suite > broken",
            status: "failed",
            attachments: []
          },
          {
            title: "infra",
            fullTitle: "suite > infra",
            status: "broken",
            attachments: []
          }
        ]
      }
    });
    const summary = buildQmoSummary({ runMetadata: md });
    const text = renderQmoSummaryMarkdown(summary);
    expect(text).toContain("### Failed Tests");
    expect(text).toContain("[failed]");
    expect(text).toContain("suite > broken");
    expect(text).toContain("[broken]");
  });

  it("renders the QG section when present", () => {
    const qg: QualityGateResult = {
      status: "failed",
      profile: "release-smoke",
      evaluatedAt: "2026-04-29T00:01:30Z",
      exitCode: 1,
      stdout: "",
      stderr: "violated",
      warnings: ["1 test failed beyond max-failures"]
    };
    const summary = buildQmoSummary({ runMetadata: makeMetadata(), qualityGateResult: qg });
    const text = renderQmoSummaryMarkdown(summary);
    expect(text).toContain("Status: `failed`");
    expect(text).toContain("Profile: `release-smoke`");
    expect(text).toContain("Exit Code: 1");
    expect(text).toContain("- QG Warnings:");
    expect(text).toContain("1 test failed beyond max-failures");
  });
});

describe("persistQmoSummary + readPersistedQualityGate", () => {
  it("writes both JSON and Markdown to the given paths, creating parents on demand", async () => {
    const md = makeMetadata();
    const summary = buildQmoSummary({ runMetadata: md });
    const jsonTarget = path.join(workdir, "deeply", "nested", "qmo.json");
    const mdTarget = path.join(workdir, "deeply", "nested", "qmo.md");

    await persistQmoSummary(jsonTarget, mdTarget, summary);
    expect(fs.existsSync(jsonTarget)).toBe(true);
    expect(fs.existsSync(mdTarget)).toBe(true);

    const json = JSON.parse(fs.readFileSync(jsonTarget, "utf8")) as { outcome: string };
    expect(json.outcome).toBe("ready");
    const markdown = fs.readFileSync(mdTarget, "utf8");
    expect(markdown).toContain("**Outcome**: `ready`");
  });

  it("returns kind='absent' for an absent quality-gate file (legitimate skip)", async () => {
    const result = await readPersistedQualityGate(path.join(workdir, "missing.json"));
    expect(result.kind).toBe("absent");
  });

  it("returns kind='unreadable' with INVALID_JSON for malformed JSON (cannot silently downgrade)", async () => {
    const target = path.join(workdir, "qg.json");
    fs.writeFileSync(target, "{ not json");
    const result = await readPersistedQualityGate(target);
    expect(result.kind).toBe("unreadable");
    if (result.kind === "unreadable") {
      expect(result.code).toBe("INVALID_JSON");
    }
  });

  it("returns kind='unreadable' with SCHEMA_MISMATCH for valid JSON that fails the schema", async () => {
    const target = path.join(workdir, "qg.json");
    fs.writeFileSync(target, JSON.stringify({ status: "no-such-status" }));
    const result = await readPersistedQualityGate(target);
    expect(result.kind).toBe("unreadable");
    if (result.kind === "unreadable") {
      expect(result.code).toBe("SCHEMA_MISMATCH");
    }
  });

  it("returns kind='found' with the parsed QualityGateResult on success", async () => {
    const target = path.join(workdir, "qg.json");
    const persisted: QualityGateResult = {
      status: "passed",
      profile: "local-review",
      evaluatedAt: "2026-04-29T00:01:30Z",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      warnings: []
    };
    fs.writeFileSync(target, JSON.stringify(persisted));
    const result = await readPersistedQualityGate(target);
    expect(result.kind).toBe("found");
    if (result.kind === "found") {
      expect(result.value.status).toBe("passed");
      expect(result.value.profile).toBe("local-review");
    }
  });
});

describe("buildQmoSummary reportLinks gating (T207 review fix)", () => {
  it("omits allureReportDir when warnings indicate the report was skipped", () => {
    const md = makeMetadata({
      warnings: ["Allure HTML report skipped: no results in run-scoped allure-results."]
    });
    const summary = buildQmoSummary({ runMetadata: md });
    expect(summary.reportLinks.allureReportDir).toBeUndefined();
  });

  it("omits allureReportDir when warnings indicate the report generation failed", () => {
    const md = makeMetadata({
      warnings: ["Allure HTML report generation failed. exitCode=1; signal=null"]
    });
    const summary = buildQmoSummary({ runMetadata: md });
    expect(summary.reportLinks.allureReportDir).toBeUndefined();
  });

  it("populates allureReportDir when no skip/fail markers are present", () => {
    const md = makeMetadata({ warnings: ["unrelated warning"] });
    const summary = buildQmoSummary({ runMetadata: md });
    expect(summary.reportLinks.allureReportDir).toBe("/runs/run-1/allure-report");
  });

  it("omits qualityGateResultPath when warnings indicate QG was skipped", () => {
    const md = makeMetadata({
      warnings: ["Allure quality-gate skipped: no results in run-scoped allure-results."]
    });
    const summary = buildQmoSummary({ runMetadata: md });
    expect(summary.reportLinks.qualityGateResultPath).toBeUndefined();
  });
});
