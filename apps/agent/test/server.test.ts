import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/server.js";
import {
  unsafelyAllowAnyArgsValidator,
  createDefaultCommandPolicy,
  type CommandPolicy
} from "../src/commands/policy.js";
import { PlaywrightCommandBuildError } from "../src/playwright/builder.js";
import type {
  DetectedPackageManager,
  ProjectSummary,
  QmoSummary,
  RunMetadata,
  TestResultSummary
} from "@pwqa/shared";
import { runPathsFor } from "../src/storage/paths.js";
import { PatchValidationError, type PatchManager } from "../src/git/patchManager.js";
import { persistRepairComparison } from "../src/repair/repairComparison.js";

let workdir: string;
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(here, "../../../tests/fixtures/sample-pw-project");

function fakePackageManager(command = { executable: process.execPath, args: ["-e", ""] }): DetectedPackageManager {
  return {
    name: "npm",
    status: "ok",
    confidence: "high",
    reason: "test",
    warnings: [],
    errors: [],
    lockfiles: ["package-lock.json"],
    packageManagerField: undefined,
    hasPlaywrightDevDependency: true,
    localBinaryUsable: true,
    blockingExecution: false,
    commandTemplates: {
      playwrightTest: command
    }
  };
}

function fakeProjectSummary(projectRoot: string, packageManager = fakePackageManager()): ProjectSummary {
  return {
    id: projectRoot,
    rootPath: projectRoot,
    packageManager,
    hasAllurePlaywright: false,
    hasAllureCli: false,
    warnings: [],
    blockingExecution: false
  };
}

function fakeRunSummary(failed = 0): TestResultSummary {
  return {
    total: 3,
    passed: 3 - failed,
    failed,
    skipped: 0,
    flaky: 0,
    failedTests:
      failed > 0
        ? [{ testId: "checkout", title: "checkout fails", status: "failed", attachments: [] }]
        : []
  };
}

function fakeRunMetadata(projectRoot: string, runId: string, failed = 0): RunMetadata {
  return {
    runId,
    projectId: projectRoot,
    projectRoot,
    status: failed > 0 ? "failed" : "passed",
    startedAt: "2026-05-01T00:00:00.000Z",
    completedAt: "2026-05-01T00:00:01.000Z",
    command: { executable: process.execPath, args: ["-e", ""] },
    cwd: projectRoot,
    exitCode: failed > 0 ? 1 : 0,
    signal: null,
    durationMs: 1_000,
    requested: { projectId: projectRoot, headed: false },
    paths: runPathsFor(projectRoot, runId),
    summary: fakeRunSummary(failed),
    warnings: []
  };
}

function writeRunMetadata(run: RunMetadata): void {
  fs.mkdirSync(run.paths.runDir, { recursive: true });
  fs.writeFileSync(run.paths.metadataJson, JSON.stringify(run, null, 2));
}

function writeQmoSummary(run: RunMetadata, summary: Partial<QmoSummary> = {}): void {
  const qmo: QmoSummary = {
    runId: run.runId,
    projectId: run.projectId,
    generatedAt: "2026-05-01T00:00:00.000Z",
    outcome: "ready",
    testSummary: run.summary,
    warnings: run.warnings,
    reportLinks: {
      allureReportDir: "https://example.com/allure",
      qualityGateResultPath: "https://example.com/quality-gate.json"
    },
    runDurationMs: run.durationMs,
    command: run.command,
    ...summary
  };
  fs.mkdirSync(path.dirname(run.paths.qmoSummaryJsonPath), { recursive: true });
  fs.writeFileSync(run.paths.qmoSummaryJsonPath, JSON.stringify(qmo, null, 2));
}

beforeAll(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-server-")));
  fs.writeFileSync(
    path.join(workdir, "package.json"),
    JSON.stringify({
      packageManager: "pnpm@10.8.0",
      devDependencies: { "@playwright/test": "^1.55.0" }
    })
  );
  fs.writeFileSync(path.join(workdir, "pnpm-lock.yaml"), "");
  fs.mkdirSync(path.join(workdir, "node_modules", ".bin"), { recursive: true });
  fs.writeFileSync(path.join(workdir, "node_modules", ".bin", "playwright"), "");
});
afterAll(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("HTTP API surface", () => {
  it("returns health status on /health", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("playwright-workbench-agent");
  });

  it("checks patches for the currently opened project", async () => {
    const patchManager: PatchManager = {
      check: vi.fn().mockResolvedValue({
        ok: true,
        filesTouched: ["src/example.ts"],
        dirtyFiles: [],
        diagnostics: "ok"
      }),
      applyTemporary: vi.fn(),
      revertTemporary: vi.fn()
    };
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      },
      patchManagerFactory: () => patchManager
    });
    projectStore.set({
      summary: fakeProjectSummary(workdir),
      packageManager: fakePackageManager()
    });

    const response = await app.request("/patches/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: workdir,
        patch: "diff --git a/src/example.ts b/src/example.ts\n"
      })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(patchManager.check).toHaveBeenCalledWith({
      projectRoot: workdir,
      patch: "diff --git a/src/example.ts b/src/example.ts\n"
    });
  });

  it("rejects malformed patch API requests before touching git", async () => {
    const patchManager: PatchManager = {
      check: vi.fn(),
      applyTemporary: vi.fn(),
      revertTemporary: vi.fn()
    };
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      },
      patchManagerFactory: () => patchManager
    });

    const response = await app.request("/patches/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: workdir, patch: "" })
    });

    expect(response.status).toBe(400);
    expect(patchManager.check).not.toHaveBeenCalled();
  });

  it("returns 404 for patch requests when the project is not open", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });

    const response = await app.request("/patches/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: workdir, patch: "diff --git a/a b/a\n" })
    });

    expect(response.status).toBe(404);
  });

  it("maps temporary patch apply and validation failures to sanitized HTTP responses", async () => {
    const patchManager: PatchManager = {
      check: vi.fn(),
      applyTemporary: vi
        .fn()
        .mockResolvedValueOnce({
          applied: false,
          filesTouched: ["src/example.ts"],
          diagnostics: "Patch target files have uncommitted changes."
        })
        .mockRejectedValueOnce(
          new PatchValidationError("Patch must contain at least one git diff header.")
        ),
      revertTemporary: vi.fn()
    };
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      },
      patchManagerFactory: () => patchManager
    });
    projectStore.set({
      summary: fakeProjectSummary(workdir),
      packageManager: fakePackageManager()
    });

    const blocked = await app.request("/patches/apply-temporary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: workdir,
        patch: "diff --git a/src/example.ts b/src/example.ts\n"
      })
    });
    const invalid = await app.request("/patches/apply-temporary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: workdir,
        patch: "diff --git a/src/example.ts b/src/example.ts\n"
      })
    });

    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe("PATCH_APPLY_FAILED");
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("PATCH_INVALID");
  });

  it("starts a repair rerun from a completed baseline run", async () => {
    const packageManager = fakePackageManager({ executable: process.execPath, args: ["-e", ""] });
    const baseline = fakeRunMetadata(workdir, "run-baseline-11111111", 1);
    writeRunMetadata(baseline);
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      },
      policyFactory: (root): CommandPolicy => ({
        allowedExecutables: ["node"],
        argValidator: unsafelyAllowAnyArgsValidator,
        cwdBoundary: root,
        envAllowlist: ["PATH"]
      })
    });
    projectStore.set({ summary: fakeProjectSummary(workdir, packageManager), packageManager });

    const response = await app.request(`/runs/${baseline.runId}/repair-rerun`, {
      method: "POST"
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.baselineRunId).toBe(baseline.runId);
    expect(body.rerunId).toMatch(/^run-[a-z0-9]+-[a-f0-9]{8}$/);
    expect(body.comparisonPath).toBe(
      path.join(baseline.paths.runDir, "reruns", body.rerunId, "comparison.json")
    );
  });

  it("returns 409 while a repair comparison artifact is not generated yet", async () => {
    const baseline = fakeRunMetadata(workdir, "run-baseline-22222222", 1);
    writeRunMetadata(baseline);
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    projectStore.set({ summary: fakeProjectSummary(workdir), packageManager: fakePackageManager() });

    const response = await app.request(
      `/runs/${baseline.runId}/repair-comparison/run-rerun-33333333`
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("NO_REPAIR_COMPARISON");
  });

  it("serves persisted repair comparison artifacts", async () => {
    const baseline = fakeRunMetadata(workdir, "run-baseline-44444444", 1);
    const rerun = fakeRunMetadata(workdir, "run-rerun-55555555", 0);
    writeRunMetadata(baseline);
    await persistRepairComparison({ baseline, rerun });
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    projectStore.set({ summary: fakeProjectSummary(workdir), packageManager: fakePackageManager() });

    const response = await app.request(
      `/runs/${baseline.runId}/repair-comparison/${rerun.runId}`
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.verdict).toBe("fixed");
    expect(body.resolvedFailures).toHaveLength(1);
  });

  it("builds a release review draft from QMO summary and linked GitHub context", async () => {
    const run = fakeRunMetadata(workdir, "run-release-11111111", 0);
    writeRunMetadata(run);
    writeQmoSummary(run, { outcome: "ready" });
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    projectStore.set({ summary: fakeProjectSummary(workdir), packageManager: fakePackageManager() });

    const response = await app.request(`/runs/${run.runId}/release-review-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pullRequest: {
          repository: "owner/repo",
          number: 42,
          title: "Release smoke",
          url: "https://github.com/owner/repo/pull/42"
        },
        issues: [
          {
            repository: "owner/repo",
            number: 7,
            title: "Known issue",
            state: "open",
            url: "https://github.com/owner/repo/issues/7"
          }
        ],
        ciArtifacts: [
          {
            name: "playwright-report",
            kind: "playwright-report",
            source: "github-actions",
            url: "https://github.com/owner/repo/actions/runs/1/artifacts/2"
          }
        ]
      })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runId).toBe(run.runId);
    expect(body.outcome).toBe("ready");
    expect(body.markdown).toContain("owner/repo#42 Release smoke");
    expect(body.markdown).toContain("playwright-report (playwright-report, github-actions)");
  });

  it("returns 409 when release review draft is requested before QMO summary exists", async () => {
    const run = fakeRunMetadata(workdir, "run-release-22222222", 0);
    writeRunMetadata(run);
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    projectStore.set({ summary: fakeProjectSummary(workdir), packageManager: fakePackageManager() });

    const response = await app.request(`/runs/${run.runId}/release-review-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("NO_QMO_SUMMARY");
  });

  it("imports CI artifact links for a run", async () => {
    const run = fakeRunMetadata(workdir, "run-ci-11111111", 0);
    writeRunMetadata(run);
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    projectStore.set({ summary: fakeProjectSummary(workdir), packageManager: fakePackageManager() });

    const response = await app.request(`/runs/${run.runId}/ci-artifacts/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artifacts: [
          {
            name: "playwright-report",
            url: "https://github.com/owner/repo/actions/runs/1/artifacts/10"
          },
          {
            name: "coverage",
            url: "https://github.com/owner/repo/actions/runs/1/artifacts/11"
          }
        ]
      })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runId).toBe(run.runId);
    expect(body.imported).toHaveLength(1);
    expect(body.imported[0].kind).toBe("playwright-report");
    expect(body.skipped[0].reason).toBe("unsupported-kind");
  });

  it("rejects CI artifact import requests with non-HTTP URLs", async () => {
    const run = fakeRunMetadata(workdir, "run-ci-22222222", 0);
    writeRunMetadata(run);
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    projectStore.set({ summary: fakeProjectSummary(workdir), packageManager: fakePackageManager() });

    const response = await app.request(`/runs/${run.runId}/ci-artifacts/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artifacts: [{ name: "playwright-report", url: "file:///tmp/report.zip" }]
      })
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects invalid repair comparison rerun ids", async () => {
    const baseline = fakeRunMetadata(workdir, "run-baseline-66666666", 1);
    writeRunMetadata(baseline);
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    projectStore.set({ summary: fakeProjectSummary(workdir), packageManager: fakePackageManager() });

    const response = await app.request(
      `/runs/${baseline.runId}/repair-comparison/not-a-run`
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_RERUN_ID");
  });

  it("returns Allure history JSONL entries via /projects/:id/allure-history (§1.3)", async () => {
    // Project must be opened first so projectStore.getById(projectId) hits.
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    const open = await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workdir })
    });
    expect(open.status).toBe(200);

    const reportsDir = path.join(workdir, ".playwright-workbench", "reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(
      path.join(reportsDir, "allure-history.jsonl"),
      [
        JSON.stringify({ generatedAt: "2026-04-30T12:00:00Z", total: 5, passed: 4, failed: 1 }),
        JSON.stringify({ generatedAt: "2026-04-30T12:01:00Z", total: 5, passed: 5, failed: 0 }),
      ].join("\n") + "\n"
    );

    const response = await app.request(
      `/projects/${encodeURIComponent(workdir)}/allure-history`
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].generatedAt).toBe("2026-04-30T12:00:00Z");
    expect(body.warnings).toEqual([]);
  });

  it("returns empty entries when allure-history.jsonl is missing (§1.3 PoC graceful degrade)", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workdir })
    });
    // Pre-clean any lingering history file from the previous test.
    fs.rmSync(path.join(workdir, ".playwright-workbench", "reports", "allure-history.jsonl"), {
      force: true,
    });

    const response = await app.request(
      `/projects/${encodeURIComponent(workdir)}/allure-history`
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ entries: [], warnings: [] });
  });

  it("returns 404 for /projects/:id/allure-history when the project is not open", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    const response = await app.request(
      `/projects/${encodeURIComponent("/nonexistent")}/allure-history`
    );
    expect(response.status).toBe(404);
  });

  it("opens a project and exposes it via /projects/current", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    const open = await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workdir })
    });
    expect(open.status).toBe(200);
    const summary = await open.json();
    expect(summary.rootPath).toBe(workdir);
    expect(summary.packageManager.name).toBe("pnpm");
    expect(summary.blockingExecution).toBe(false);

    const current = await app.request("/projects/current");
    expect(current.status).toBe(200);
    const currentBody = await current.json();
    expect(currentBody.rootPath).toBe(workdir);
  });

  it("builds inventory for an opened project outside apps/agent cwd", async () => {
    const fixtureRealpath = fs.realpathSync(fixtureRoot);
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [fixtureRealpath],
        failClosedAudit: false
      }
    });
    const open = await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: fixtureRealpath })
    });
    expect(open.status).toBe(200);

    const inventory = await app.request(
      `/projects/${encodeURIComponent(fixtureRealpath)}/inventory`
    );
    expect(inventory.status).toBe(200);
    const body = await inventory.json();
    expect(body.source).toBe("playwright-list-json");
    expect(body.error).toBeUndefined();
    expect(body.totals.tests).toBeGreaterThanOrEqual(2);
    const titles = body.specs.flatMap((spec: { tests: Array<{ title: string }> }) =>
      spec.tests.map((test) => test.title)
    );
    expect(titles).toContain("trivial passing assertion");
  }, 90_000);

  it("returns a read-only config summary for an opened project", async () => {
    const fixtureRealpath = fs.realpathSync(fixtureRoot);
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [fixtureRealpath],
        failClosedAudit: false
      }
    });
    const open = await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: fixtureRealpath })
    });
    expect(open.status).toBe(200);

    const response = await app.request(
      `/projects/${encodeURIComponent(fixtureRealpath)}/config-summary`
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.config.relativePath).toBe("playwright.config.ts");
    expect(body.reporters).toContainEqual({ name: "list", source: "heuristic" });
    expect(body.fixtureFiles).toEqual([]);
  });

  it("passes each project root to the injected policy factory", async () => {
    const requestedRoots: string[] = [];
    const { runnerForProject } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      },
      policyFactory: (projectRoot) => {
        requestedRoots.push(projectRoot);
        return createDefaultCommandPolicy(projectRoot);
      }
    });

    expect(() =>
      runnerForProject(workdir).run({
        executable: "git",
        args: ["push"],
        cwd: workdir
      })
    ).toThrow(/not in the allowed list/);
    expect(requestedRoots).toEqual([workdir]);
  });

  it("keeps project-scoped runners isolated across project roots", () => {
    const otherRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-server-other-")));
    try {
      const { runnerForProject } = buildApp({
        env: {
          port: 0,
          host: "127.0.0.1",
          logLevel: "silent",
          allowedRoots: [workdir, otherRoot],
          failClosedAudit: false
        },
        policyFactory: (projectRoot): CommandPolicy => ({
          allowedExecutables: ["node"],
          argValidator: unsafelyAllowAnyArgsValidator,
          cwdBoundary: projectRoot,
          envAllowlist: ["PATH"]
        })
      });

      expect(() =>
        runnerForProject(workdir).run({
          executable: process.execPath,
          args: ["-e", ""],
          cwd: otherRoot
        })
      ).toThrow(/escapes the project boundary/);
    } finally {
      fs.rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it("does not follow symlinks when writing project audit logs", async () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-audit-outside-")));
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-audit-project-")));
    fs.symlinkSync(outside, path.join(projectRoot, ".playwright-workbench"));
    const permissiveNodePolicy = (root: string): CommandPolicy => ({
      allowedExecutables: ["node"],
      argValidator: unsafelyAllowAnyArgsValidator,
      cwdBoundary: root,
      envAllowlist: ["PATH"]
    });

    try {
      const { runnerForProject } = buildApp({
        env: {
          port: 0,
          host: "127.0.0.1",
          logLevel: "silent",
          allowedRoots: [projectRoot],
          failClosedAudit: false
        },
        policyFactory: permissiveNodePolicy
      });
      const handle = runnerForProject(projectRoot).run({
        executable: process.execPath,
        args: ["-e", ""],
        cwd: projectRoot
      });
      await handle.result;

      expect(fs.existsSync(path.join(outside, "audit.log"))).toBe(false);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("runs normally when failClosedAudit is enabled and audit persistence succeeds", async () => {
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-audit-ok-")));
    const permissiveNodePolicy = (root: string): CommandPolicy => ({
      allowedExecutables: ["node"],
      argValidator: unsafelyAllowAnyArgsValidator,
      cwdBoundary: root,
      envAllowlist: ["PATH"]
    });

    try {
      const { runnerForProject } = buildApp({
        env: {
          port: 0,
          host: "127.0.0.1",
          logLevel: "silent",
          allowedRoots: [projectRoot],
          failClosedAudit: true
        },
        policyFactory: permissiveNodePolicy
      });
      const handle = runnerForProject(projectRoot).run({
        executable: process.execPath,
        args: ["-e", ""],
        cwd: projectRoot
      });

      await expect(handle.result).resolves.toEqual(expect.objectContaining({ exitCode: 0 }));
      const auditPath = path.join(projectRoot, ".playwright-workbench", "audit.log");
      const auditLines = fs.readFileSync(auditPath, "utf8").trim().split("\n");
      expect(auditLines).toHaveLength(1);
      expect(JSON.parse(auditLines[0]!)).toEqual(
        expect.objectContaining({
          executable: process.execPath,
          args: ["-e", ""],
          cwd: projectRoot
        })
      );
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("sanitizes POST /runs startup failures in HTTP responses", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      },
      policyFactory: (): CommandPolicy => {
        throw new Error(`policy failed at ${workdir}`);
      }
    });
    await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workdir })
    });

    const response = await app.request("/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: workdir, headed: false })
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("RUN_START_FAILED");
    expect(body.error.message).toBe("Run failed before it could be started.");
    expect(body.error.message).not.toContain(workdir);
  });

  it("maps command policy startup failures to a sanitized HTTP code", async () => {
    const packageManager = fakePackageManager({ executable: process.execPath, args: ["-e", ""] });
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      },
      policyFactory: (root): CommandPolicy => ({
        allowedExecutables: ["definitely-not-node"],
        argValidator: unsafelyAllowAnyArgsValidator,
        cwdBoundary: root,
        envAllowlist: ["PATH"]
      })
    });
    projectStore.set({ summary: fakeProjectSummary(workdir, packageManager), packageManager });

    const response = await app.request("/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: workdir, headed: false })
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("RUN_COMMAND_REJECTED");
    expect(body.error.message).toBe("Runner rejected the command before spawn.");
    expect(body.error.message).not.toContain(workdir);
  });

  it("maps command build startup failures to a sanitized HTTP code", async () => {
    const packageManager = fakePackageManager({ executable: process.execPath, args: ["-e", ""] });
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      },
      policyFactory: () => {
        throw new PlaywrightCommandBuildError(`specPath escaped through ${workdir}`, "INVALID_SPEC_PATH");
      }
    });
    projectStore.set({ summary: fakeProjectSummary(workdir, packageManager), packageManager });

    const response = await app.request("/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: workdir, headed: false })
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("RUN_COMMAND_BUILD_FAILED");
    expect(body.error.message).toBe("Run command could not be built from the request.");
    expect(body.error.message).not.toContain(workdir);
  });

  it("maps fail-closed audit persistence failures to a sanitized HTTP code", async () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-http-audit-outside-")));
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-http-audit-project-")));
    const packageManager = fakePackageManager({ executable: process.execPath, args: ["-e", ""] });
    fs.symlinkSync(outside, path.join(projectRoot, ".playwright-workbench"));
    try {
      const { app, projectStore } = buildApp({
        env: {
          port: 0,
          host: "127.0.0.1",
          logLevel: "silent",
          allowedRoots: [projectRoot],
          failClosedAudit: true
        },
        policyFactory: (root): CommandPolicy => ({
          allowedExecutables: ["node"],
          argValidator: unsafelyAllowAnyArgsValidator,
          cwdBoundary: root,
          envAllowlist: ["PATH"]
        })
      });
      projectStore.set({ summary: fakeProjectSummary(projectRoot, packageManager), packageManager });

      const response = await app.request("/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: projectRoot, headed: false })
      });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error.code).toBe("RUN_AUDIT_PERSIST_FAILED");
      expect(body.error.message).toBe("Run could not start because audit logging failed.");
      expect(body.error.message).not.toContain(projectRoot);
      expect(body.error.message).not.toContain(outside);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("fails closed on audit persistence errors when AGENT_FAIL_CLOSED_AUDIT is enabled", async () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-audit-outside-")));
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-audit-project-")));
    fs.symlinkSync(outside, path.join(projectRoot, ".playwright-workbench"));
    const permissiveNodePolicy = (root: string): CommandPolicy => ({
      allowedExecutables: ["node"],
      argValidator: unsafelyAllowAnyArgsValidator,
      cwdBoundary: root,
      envAllowlist: ["PATH"]
    });
    const auditObserver = vi.fn();

    try {
      const { runnerForProject } = buildApp({
        env: {
          port: 0,
          host: "127.0.0.1",
          logLevel: "silent",
          allowedRoots: [projectRoot],
          failClosedAudit: true
        },
        policyFactory: permissiveNodePolicy,
        audit: auditObserver
      });

      expect(() =>
        runnerForProject(projectRoot).run({
          executable: process.execPath,
          args: ["-e", ""],
          cwd: projectRoot
        })
      ).toThrow(/Audit persistence failed/);
      expect(auditObserver).toHaveBeenCalledWith(
        expect.objectContaining({
          executable: process.execPath,
          args: ["-e", ""],
          cwd: projectRoot
        })
      );
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("keeps audit observer failures fail-open and separate from persistence failures", async () => {
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-audit-observer-")));
    const permissiveNodePolicy = (root: string): CommandPolicy => ({
      allowedExecutables: ["node"],
      argValidator: unsafelyAllowAnyArgsValidator,
      cwdBoundary: root,
      envAllowlist: ["PATH"]
    });
    const errors: Array<Record<string, unknown>> = [];
    const infos: Array<Record<string, unknown>> = [];
    const captureLogger = {
      error(payload: Record<string, unknown>) {
        errors.push(payload);
      },
      warn() {},
      info(payload: Record<string, unknown>) {
        infos.push(payload);
      },
      debug() {}
    };

    try {
      const { runnerForProject } = buildApp({
        env: {
          port: 0,
          host: "127.0.0.1",
          logLevel: "silent",
          allowedRoots: [projectRoot],
          failClosedAudit: true
        },
        policyFactory: permissiveNodePolicy,
        audit: () => {
          throw new Error("observer failed at /private/audit-hook");
        },
        logger: captureLogger
      });

      const handle = runnerForProject(projectRoot).run({
        executable: process.execPath,
        args: ["-e", ""],
        cwd: projectRoot
      });

      await expect(handle.result).resolves.toEqual(
        expect.objectContaining({ exitCode: 0, cancelled: false })
      );
      expect(fs.existsSync(path.join(projectRoot, ".playwright-workbench", "audit.log"))).toBe(true);

      // Issue #27: structured-log payload for audit observer failure must not
      // leak the path-bearing error message ("/private/audit-hook").
      const observerEntry = errors.find((entry) => entry.errorName === "Error");
      expect(observerEntry).toBeDefined();
      expect(observerEntry).not.toHaveProperty("err");
      expect(JSON.stringify(errors)).not.toContain("/private/audit-hook");

      // The `command audit` info echo must not leak `cwd` (= projectRoot) in
      // structured logs; it should appear as `cwdHash` instead.
      const auditInfoEntry = infos.find(
        (entry) => entry.audit !== undefined
      );
      expect(auditInfoEntry).toBeDefined();
      const auditPayload = auditInfoEntry!.audit as Record<string, unknown>;
      expect(auditPayload).not.toHaveProperty("cwd");
      expect(auditPayload).toHaveProperty("cwdHash");
      expect(typeof auditPayload.cwdHash).toBe("string");
      expect(auditPayload.cwdHash as string).toMatch(/^[0-9a-f]{8}$/);
      expect(JSON.stringify(infos)).not.toContain(projectRoot);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not leak projectRoot or directory paths in audit-persist failure logs", async () => {
    // Issue #27 项目 3 regression test: the symlink-based audit-dir failure
    // path throws a plain Error whose message embeds projectRoot. The
    // fail-closed `errorLogFields` helper must drop that message and only
    // keep `code` + `errorName` + `artifactKind: "audit-log"`.
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-audit-leak-outside-")));
    const projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-audit-leak-project-")));
    fs.symlinkSync(outside, path.join(projectRoot, ".playwright-workbench"));
    const errors: Array<Record<string, unknown>> = [];
    const captureLogger = {
      error(payload: Record<string, unknown>) {
        errors.push(payload);
      },
      warn() {},
      info() {},
      debug() {}
    };
    try {
      const { app, projectStore } = buildApp({
        env: {
          port: 0,
          host: "127.0.0.1",
          logLevel: "silent",
          allowedRoots: [projectRoot],
          failClosedAudit: true
        },
        policyFactory: (root): CommandPolicy => ({
          allowedExecutables: ["node"],
          argValidator: unsafelyAllowAnyArgsValidator,
          cwdBoundary: root,
          envAllowlist: ["PATH"]
        }),
        logger: captureLogger
      });
      projectStore.set({
        summary: fakeProjectSummary(projectRoot, fakePackageManager()),
        packageManager: fakePackageManager()
      });

      const response = await app.request("/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: projectRoot, headed: false })
      });
      expect(response.status).toBe(500);

      const auditLogEntry = errors.find((e) => e.artifactKind === "audit-log");
      expect(auditLogEntry).toBeDefined();
      expect(auditLogEntry).not.toHaveProperty("err");
      expect(auditLogEntry).not.toHaveProperty("projectRoot");
      const errorsAsJson = JSON.stringify(errors);
      expect(errorsAsJson).not.toContain(projectRoot);
      expect(errorsAsJson).not.toContain(outside);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects /projects/open paths outside the allowed roots", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [path.join(os.tmpdir(), "definitely-not-here")],
        failClosedAudit: false
      }
    });
    const open = await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workdir })
    });
    expect(open.status).toBe(403);
    const body = await open.json();
    expect(body.error.code).toBe("PROJECT_NOT_ALLOWED");
  });

  it("returns 404 for runs when no project is open", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    const response = await app.request("/runs/non-existent");
    expect(response.status).toBe(404);
  });

  it("includes warnings in GET /runs list items", async () => {
    const runDir = path.join(workdir, ".playwright-workbench", "runs", "r-warning-list");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "metadata.json"),
      JSON.stringify({
        runId: "r-warning-list",
        projectId: workdir,
        projectRoot: workdir,
        status: "passed",
        startedAt: "2026-04-28T00:00:00Z",
        completedAt: "2026-04-28T00:00:01Z",
        command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
        cwd: workdir,
        exitCode: 0,
        signal: null,
        durationMs: 1000,
        requested: { projectId: workdir, headed: false },
        paths: {
          runDir,
          metadataJson: path.join(runDir, "metadata.json"),
          stdoutLog: path.join(runDir, "stdout.log"),
          stderrLog: path.join(runDir, "stderr.log"),
          playwrightJson: path.join(runDir, "playwright-results.json"),
          playwrightHtml: path.join(runDir, "playwright-report"),
          artifactsJson: path.join(runDir, "artifacts.json")
        },
        warnings: ["stdout log write failed; websocket stream was still delivered. code=ENOSPC; failures=1"]
      })
    );
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workdir })
    });

    const response = await app.request("/runs");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: "r-warning-list",
          warnings: [
            "stdout log write failed; websocket stream was still delivered. code=ENOSPC; failures=1"
          ]
        })
      ])
    );
  });

  it("returns 400 for malformed /projects/open body", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    const response = await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects /runs RunRequest with traversal in specPath", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workdir })
    });
    const response = await app.request("/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: workdir,
        specPath: "../../etc/passwd"
      })
    });
    expect(response.status).toBe(400);
  });

  it("rejects /runs RunRequest with grep starting with -", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workdir })
    });
    const response = await app.request("/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: workdir,
        grep: "--inject-flag"
      })
    });
    expect(response.status).toBe(400);
  });

  it("rejects /runs RunRequest with invalid retries or workers", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workdir })
    });

    const invalidRetries = await app.request("/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: workdir,
        retries: -1
      })
    });
    expect(invalidRetries.status).toBe(400);

    const invalidWorkers = await app.request("/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: workdir,
        workers: 0
      })
    });
    expect(invalidWorkers.status).toBe(400);
  });

  it("only echoes Access-Control-Allow-Origin for allowed origins", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    const allowed = await app.request("/health", {
      headers: { Origin: "http://127.0.0.1:5173" }
    });
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("http://127.0.0.1:5173");
    const denied = await app.request("/health", {
      headers: { Origin: "http://attacker.example" }
    });
    expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not leak path in structured logs when initialProjectRoot fails to scan", async () => {
    // Issue #27 regression test: the `Failed to load initial project` catch
    // path was previously logging `err: error.message`, which can carry
    // ENOENT path strings. The fail-closed `errorLogFields` helper must
    // produce a payload free of any absolute path.
    const allowedRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-init-leak-")));
    const missingProject = path.join(allowedRoot, "nonexistent-subdir");
    const errors: Array<Record<string, unknown>> = [];
    const infos: Array<Record<string, unknown>> = [];
    const captureLogger = {
      error(payload: Record<string, unknown>) {
        errors.push(payload);
      },
      warn() {},
      info(payload: Record<string, unknown>) {
        infos.push(payload);
      },
      debug() {}
    };

    try {
      buildApp({
        env: {
          port: 0,
          host: "127.0.0.1",
          logLevel: "silent",
          allowedRoots: [allowedRoot],
          failClosedAudit: false,
          initialProjectRoot: missingProject
        },
        logger: captureLogger
      });
      // The scan promise resolves on the next microtask tick; await it.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const initEntry = errors.find((e) => typeof e.errorName === "string");
      expect(initEntry).toBeDefined();
      expect(initEntry).not.toHaveProperty("err");
      const errorsAsJson = JSON.stringify(errors);
      expect(errorsAsJson).not.toContain(missingProject);
      expect(errorsAsJson).not.toContain(allowedRoot);
    } finally {
      fs.rmSync(allowedRoot, { recursive: true, force: true });
    }
  });

  it("returns Phase 2 failure review detail via /runs/:runId/failure-review", async () => {
    const runIdLocal = "r-failure-review";
    const runDir = path.join(workdir, ".playwright-workbench", "runs", runIdLocal);
    fs.mkdirSync(path.join(runDir, "allure-results"), { recursive: true });
    fs.mkdirSync(path.join(workdir, ".playwright-workbench", "reports"), { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "metadata.json"),
      JSON.stringify({
        runId: runIdLocal,
        projectId: workdir,
        projectRoot: workdir,
        status: "failed",
        startedAt: "2026-04-29T00:00:00Z",
        completedAt: "2026-04-29T00:01:00Z",
        command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
        cwd: workdir,
        exitCode: 1,
        signal: null,
        durationMs: 1000,
        requested: { projectId: workdir, headed: false },
        paths: {
          runDir,
          metadataJson: path.join(runDir, "metadata.json"),
          stdoutLog: path.join(runDir, "stdout.log"),
          stderrLog: path.join(runDir, "stderr.log"),
          playwrightJson: path.join(runDir, "playwright-results.json"),
          playwrightHtml: path.join(runDir, "playwright-report"),
          artifactsJson: path.join(runDir, "artifacts.json"),
          allureResultsDest: path.join(runDir, "allure-results"),
          allureReportDir: path.join(runDir, "allure-report"),
          qualityGateResultPath: path.join(runDir, "quality-gate-result.json"),
          allureExportsDir: path.join(runDir, "allure-exports"),
          allureCsvPath: path.join(runDir, "allure-exports", "results.csv"),
          allureLogPath: path.join(runDir, "allure-exports", "results.log"),
          qmoSummaryJsonPath: path.join(runDir, "qmo-summary.json"),
          qmoSummaryMarkdownPath: path.join(runDir, "qmo-summary.md")
        },
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          flaky: 0,
          failedTests: [
            {
              testId: "pw-id",
              title: "should checkout",
              fullTitle: "checkout > should checkout",
              status: "failed",
              stack: "at tests/checkout.spec.ts:1:1",
              attachments: []
            }
          ]
        },
        warnings: []
      })
    );
    fs.writeFileSync(
      path.join(runDir, "allure-results", "uuid-result.json"),
      JSON.stringify({
        uuid: "allure-uuid",
        historyId: "hist-checkout",
        fullName: "checkout > should checkout",
        name: "should checkout",
        status: "failed"
      })
    );
    fs.writeFileSync(
      path.join(workdir, ".playwright-workbench", "reports", "allure-history.jsonl"),
      [
        JSON.stringify({
          generatedAt: "2026-04-30T00:00:00Z",
          testResults: { "hist-checkout": { status: "passed" } }
        }),
        JSON.stringify({
          generatedAt: "2026-04-30T00:10:00Z",
          testResults: { "hist-checkout": { status: "failed" } }
        })
      ].join("\n") + "\n"
    );
    fs.writeFileSync(
      path.join(workdir, ".playwright-workbench", "reports", "known-issues.json"),
      JSON.stringify([{ historyId: "hist-checkout", title: "tracked checkout issue" }])
    );

    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workdir })
    });

    const response = await app.request(`/runs/${runIdLocal}/failure-review`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.failedTests[0].history.map((entry: { status: string }) => entry.status)).toEqual([
      "passed",
      "failed"
    ]);
    expect(body.failedTests[0].knownIssues[0].title).toBe("tracked checkout issue");
    expect(body.failedTests[0].flaky.isCandidate).toBe(true);
  });

  it("runs AI analysis for a failed run and persists the validated response", async () => {
    const runIdLocal = "r-ai-analysis";
    const paths = runPathsFor(workdir, runIdLocal);
    fs.mkdirSync(paths.runDir, { recursive: true });
    fs.writeFileSync(
      paths.metadataJson,
      JSON.stringify({
        runId: runIdLocal,
        projectId: workdir,
        projectRoot: workdir,
        status: "failed",
        startedAt: "2026-04-29T00:00:00Z",
        completedAt: "2026-04-29T00:01:00Z",
        command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
        cwd: workdir,
        exitCode: 1,
        signal: null,
        durationMs: 1000,
        requested: { projectId: workdir, headed: false },
        paths,
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          skipped: 0,
          flaky: 0,
          failedTests: [
            {
              testId: "pw-id",
              title: "should checkout",
              fullTitle: "checkout > should checkout",
              status: "failed",
              stack: `at ${path.join(workdir, "tests/checkout.spec.ts")}:1:1`,
              attachments: []
            }
          ]
        },
        warnings: []
      })
    );
    let capturedRunId: string | undefined;
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      },
      aiAdapterFactory: () => ({
        async analyze(input) {
          capturedRunId = input.context.runId;
          expect(JSON.stringify(input.context)).not.toContain(workdir);
          return {
            classification: "test-bug",
            rootCause: "Assertion expected stale checkout copy.",
            evidence: ["failure context includes checkout stack"],
            risk: ["test-only change"],
            filesTouched: ["tests/checkout.spec.ts"],
            confidence: 0.75,
            requiresHumanDecision: false
          };
        }
      })
    });
    await app.request("/projects/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rootPath: workdir })
    });

    const response = await app.request(`/runs/${runIdLocal}/ai-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    expect(response.status).toBe(200);
    expect(capturedRunId).toBe(runIdLocal);
    const body = await response.json();
    expect(body.analysis.classification).toBe("test-bug");
    const persisted = JSON.parse(fs.readFileSync(path.join(paths.runDir, "ai-analysis.json"), "utf8"));
    expect(persisted.analysis.rootCause).toBe("Assertion expected stale checkout copy.");
  });

  it("runs AI test generation through the redacted gateway context", async () => {
    const run = fakeRunMetadata(workdir, "run-ai-gen-11111111", 1);
    writeRunMetadata(run);
    let capturedObjective: string | undefined;
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      },
      aiAdapterFactory: () => ({
        async analyze() {
          throw new Error("not used");
        },
        async generateTests(input) {
          capturedObjective = input.context.objective;
          expect(input.context.mode).toBe("healer");
          expect(input.context.targetFiles).toEqual(["tests/generated.spec.ts"]);
          expect(JSON.stringify(input.context)).not.toContain(workdir);
          return {
            plan: ["Add generated coverage"],
            proposedPatch: "diff --git a/tests/generated.spec.ts b/tests/generated.spec.ts\n",
            filesTouched: ["tests/generated.spec.ts"],
            evidence: ["failure context includes checkout"],
            risk: ["test-only change"],
            confidence: 0.72,
            requiresHumanDecision: false
          };
        }
      })
    });
    projectStore.set({ summary: fakeProjectSummary(workdir), packageManager: fakePackageManager() });

    const response = await app.request(`/runs/${run.runId}/ai-test-generation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "healer",
        objective: "Generate a regression test for checkout failure.",
        targetFiles: ["tests/generated.spec.ts"]
      })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(capturedObjective).toBe("Generate a regression test for checkout failure.");
    expect(body.mode).toBe("healer");
    expect(body.result.filesTouched).toEqual(["tests/generated.spec.ts"]);
  });

  it("serves linkable evidence artifacts through index-based routes", async () => {
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    projectStore.set({ summary: fakeProjectSummary(workdir), packageManager: fakePackageManager() });
    const screenshotPath = path.join(workdir, "test-results", "checkout.png");
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    fs.writeFileSync(screenshotPath, "png-bytes");
    const run = fakeRunMetadata(workdir, "evidence-run", 1);
    run.summary!.failedTests[0]!.attachments = [
      { kind: "screenshot", label: "screenshot", path: screenshotPath },
      { kind: "log", label: "stdout", path: path.join(workdir, "stdout.log") }
    ];
    writeRunMetadata(run);

    const response = await app.request("/runs/evidence-run/evidence/0/0");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(await response.text()).toBe("png-bytes");

    const unsupportedKind = await app.request("/runs/evidence-run/evidence/0/1");
    expect(unsupportedKind.status).toBe(404);
  });

  it("rejects evidence artifacts outside the opened project root", async () => {
    const { app, projectStore } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir],
        failClosedAudit: false
      }
    });
    projectStore.set({ summary: fakeProjectSummary(workdir), packageManager: fakePackageManager() });
    const outsidePath = path.join(path.dirname(workdir), "outside-evidence.png");
    fs.writeFileSync(outsidePath, "outside");
    try {
      const run = fakeRunMetadata(workdir, "outside-evidence-run", 1);
      run.summary!.failedTests[0]!.attachments = [
        { kind: "screenshot", label: "outside", path: outsidePath }
      ];
      writeRunMetadata(run);

      const response = await app.request("/runs/outside-evidence-run/evidence/0/0");
      expect(response.status).toBe(404);
    } finally {
      fs.rmSync(outsidePath, { force: true });
    }
  });

  /* -------------------------------------------------------------- */
  /* T208-1: GET /runs/:runId/qmo-summary{,.md}                     */
  /* -------------------------------------------------------------- */

  describe("GET /runs/:runId/qmo-summary (T208-1)", () => {
    function seedRun(runIdLocal: string): void {
      const runDir = path.join(workdir, ".playwright-workbench", "runs", runIdLocal);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(
        path.join(runDir, "metadata.json"),
        JSON.stringify({
          runId: runIdLocal,
          projectId: workdir,
          projectRoot: workdir,
          status: "passed",
          startedAt: "2026-04-29T00:00:00Z",
          completedAt: "2026-04-29T00:01:00Z",
          command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
          cwd: workdir,
          exitCode: 0,
          signal: null,
          durationMs: 1000,
          requested: { projectId: workdir, headed: false },
          paths: {
            runDir,
            metadataJson: path.join(runDir, "metadata.json"),
            stdoutLog: path.join(runDir, "stdout.log"),
            stderrLog: path.join(runDir, "stderr.log"),
            playwrightJson: path.join(runDir, "playwright-results.json"),
            playwrightHtml: path.join(runDir, "playwright-report"),
            artifactsJson: path.join(runDir, "artifacts.json"),
            allureResultsDest: path.join(runDir, "allure-results"),
            allureReportDir: path.join(runDir, "allure-report"),
            qualityGateResultPath: path.join(runDir, "quality-gate-result.json"),
            allureExportsDir: path.join(runDir, "allure-exports"),
            allureCsvPath: path.join(runDir, "allure-exports", "results.csv"),
            allureLogPath: path.join(runDir, "allure-exports", "results.log"),
            qmoSummaryJsonPath: path.join(runDir, "qmo-summary.json"),
            qmoSummaryMarkdownPath: path.join(runDir, "qmo-summary.md")
          },
          warnings: []
        })
      );
    }

    function buildAppForQmo() {
      return buildApp({
        env: {
          port: 0,
          host: "127.0.0.1",
          logLevel: "silent",
          allowedRoots: [workdir],
          failClosedAudit: false
        }
      });
    }

    async function openProjectAndQuery(
      app: Awaited<ReturnType<typeof buildAppForQmo>>["app"],
      runIdLocal: string,
      suffix = ""
    ) {
      await app.request("/projects/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootPath: workdir })
      });
      return app.request(`/runs/${runIdLocal}/qmo-summary${suffix}`);
    }

    it("returns 409 NO_QMO_SUMMARY when the file does not exist (run still in progress / no Allure)", async () => {
      const runIdLocal = "r-qmo-absent";
      seedRun(runIdLocal);
      const { app } = buildAppForQmo();
      const response = await openProjectAndQuery(app, runIdLocal);
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe("NO_QMO_SUMMARY");
    });

    it("returns 200 with the parsed QmoSummary when the file exists and is valid", async () => {
      const runIdLocal = "r-qmo-valid";
      seedRun(runIdLocal);
      const runDir = path.join(workdir, ".playwright-workbench", "runs", runIdLocal);
      const validSummary = {
        runId: runIdLocal,
        projectId: workdir,
        generatedAt: "2026-04-29T00:01:30Z",
        outcome: "ready",
        testSummary: {
          total: 2,
          passed: 2,
          failed: 0,
          skipped: 0,
          flaky: 0,
          failedTests: []
        },
        warnings: [],
        reportLinks: {
          allureReportDir: path.join(runDir, "allure-report")
        }
      };
      fs.writeFileSync(path.join(runDir, "qmo-summary.json"), JSON.stringify(validSummary));
      const { app } = buildAppForQmo();
      const response = await openProjectAndQuery(app, runIdLocal);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.runId).toBe(runIdLocal);
      expect(body.outcome).toBe("ready");
      expect(body.testSummary.total).toBe(2);
    });

    it("returns 500 INVALID_QMO_SUMMARY when the file is malformed JSON", async () => {
      const runIdLocal = "r-qmo-malformed";
      seedRun(runIdLocal);
      const runDir = path.join(workdir, ".playwright-workbench", "runs", runIdLocal);
      fs.writeFileSync(path.join(runDir, "qmo-summary.json"), "{ not valid json");
      const { app } = buildAppForQmo();
      const response = await openProjectAndQuery(app, runIdLocal);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_QMO_SUMMARY");
    });

    it("returns 500 INVALID_QMO_SUMMARY when the JSON shape fails the schema", async () => {
      const runIdLocal = "r-qmo-schema-bad";
      seedRun(runIdLocal);
      const runDir = path.join(workdir, ".playwright-workbench", "runs", runIdLocal);
      // Missing required `outcome` field.
      fs.writeFileSync(
        path.join(runDir, "qmo-summary.json"),
        JSON.stringify({ runId: runIdLocal, projectId: "/p", generatedAt: "x" })
      );
      const { app } = buildAppForQmo();
      const response = await openProjectAndQuery(app, runIdLocal);
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("INVALID_QMO_SUMMARY");
    });

    it("returns 404 when the runId does not exist", async () => {
      const { app } = buildAppForQmo();
      const response = await openProjectAndQuery(app, "r-does-not-exist");
      expect(response.status).toBe(404);
    });

    it("Markdown variant: returns 409 when absent and 200 text/markdown when present", async () => {
      const runIdLocal = "r-qmo-md";
      seedRun(runIdLocal);
      const { app } = buildAppForQmo();

      // 409 when absent
      const absent = await openProjectAndQuery(app, runIdLocal, ".md");
      expect(absent.status).toBe(409);

      // 200 text/markdown when present
      const runDir = path.join(workdir, ".playwright-workbench", "runs", runIdLocal);
      fs.writeFileSync(
        path.join(runDir, "qmo-summary.md"),
        "# QMO Release Readiness Summary\n- **Outcome**: `ready`\n"
      );
      const present = await app.request(`/runs/${runIdLocal}/qmo-summary.md`);
      expect(present.status).toBe(200);
      expect(present.headers.get("content-type")).toContain("text/markdown");
      const body = await present.text();
      expect(body).toContain("# QMO Release Readiness Summary");
    });
  });
});
