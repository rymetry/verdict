import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/server.js";
import { createDefaultCommandPolicy, type CommandPolicy } from "../src/commands/policy.js";

let workdir: string;
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(here, "../../../tests/fixtures/sample-pw-project");

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
        allowedRoots: [workdir]
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
        allowedRoots: [workdir]
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
        allowedRoots: [fixtureRealpath]
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
        allowedRoots: [workdir]
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
          allowedRoots: [workdir, otherRoot]
        },
        policyFactory: (projectRoot): CommandPolicy => ({
          allowedExecutables: ["node"],
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
      cwdBoundary: root,
      envAllowlist: ["PATH"]
    });

    try {
      const { runnerForProject } = buildApp({
        env: {
          port: 0,
          host: "127.0.0.1",
          logLevel: "silent",
          allowedRoots: [projectRoot]
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

  it("rejects /projects/open paths outside the allowed roots", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [path.join(os.tmpdir(), "definitely-not-here")]
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
        allowedRoots: [workdir]
      }
    });
    const response = await app.request("/runs/non-existent");
    expect(response.status).toBe(404);
  });

  it("returns 400 for malformed /projects/open body", async () => {
    const { app } = buildApp({
      env: {
        port: 0,
        host: "127.0.0.1",
        logLevel: "silent",
        allowedRoots: [workdir]
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
        allowedRoots: [workdir]
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
        allowedRoots: [workdir]
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
        allowedRoots: [workdir]
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
