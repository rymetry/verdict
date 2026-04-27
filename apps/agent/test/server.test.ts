import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildApp } from "../src/server.js";

let workdir: string;

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
});
