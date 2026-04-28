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
import type { DetectedPackageManager, ProjectSummary } from "@pwqa/shared";

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
});
