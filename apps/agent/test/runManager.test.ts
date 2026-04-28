import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNodeCommandRunner } from "../src/commands/runner.js";
import { createEventBus } from "../src/events/bus.js";
import { createRunManager } from "../src/playwright/runManager.js";
import {
  type DetectedPackageManager,
  type WorkbenchEvent
} from "@pwqa/shared";

let workdir: string;

const STUB_SUCCESS_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const reportEnv = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME;
if (reportEnv) {
  fs.mkdirSync(path.dirname(reportEnv), { recursive: true });
  fs.writeFileSync(
    reportEnv,
    JSON.stringify({
      stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, duration: 5 },
      suites: []
    })
  );
}
process.stdout.write('hello world');
process.exit(0);
`;

const STUB_FAILURE_SCRIPT = `process.exit(1);`;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-runmgr-")));
});
afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function fakePackageManager(): DetectedPackageManager {
  return {
    name: "npm",
    status: "ok",
    confidence: "high",
    reason: "test",
    warnings: [],
    errors: [],
    lockfiles: ["package-lock.json"],
    hasPlaywrightDevDependency: true,
    localBinaryUsable: true,
    blockingExecution: false,
    commandTemplates: {
      playwrightTest: { executable: "node", args: [] }
    }
  };
}

function writeStub(name: string, source: string): string {
  const filePath = path.join(workdir, name);
  fs.writeFileSync(filePath, source);
  return filePath;
}

describe("RunManager", () => {
  it("publishes start/stdout/completed events for a successful run", async () => {
    const bus = createEventBus();
    const runner = createNodeCommandRunner({
      policy: {
        allowedExecutables: ["node"],
        cwdBoundary: workdir,
        envAllowlist: [
          "PATH",
          "HOME",
          "PLAYWRIGHT_JSON_OUTPUT_NAME",
          "PLAYWRIGHT_HTML_REPORT",
          "PLAYWRIGHT_HTML_OPEN"
        ]
      }
    });
    const manager = createRunManager({ runnerForProject: () => runner, bus });

    const events: WorkbenchEvent[] = [];
    bus.subscribe((event) => events.push(event));

    const stubPath = writeStub("stub.js", STUB_SUCCESS_SCRIPT);
    const pm = fakePackageManager();
    pm.commandTemplates.playwrightTest = { executable: "node", args: [stubPath] };

    const handle = await manager.startRun({
      projectId: workdir,
      projectRoot: workdir,
      packageManager: pm,
      request: { projectId: workdir, headed: false }
    });
    const completed = await handle.finished;

    expect(completed.status).toBe("passed");
    expect(completed.summary?.total).toBe(1);
    expect(completed.summary?.passed).toBe(1);
    const types = events.map((event) => event.type);
    expect(types).toContain("run.queued");
    expect(types).toContain("run.started");
    expect(types).toContain("run.stdout");
    expect(types).toContain("run.completed");
    const runDir = path.join(workdir, ".playwright-workbench", "runs", handle.runId);
    expect(fs.existsSync(path.join(runDir, "metadata.json"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "stdout.log"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "playwright-results.json"))).toBe(true);
  });

  it("publishes run.completed with status 'failed' on non-zero exit", async () => {
    const bus = createEventBus();
    const runner = createNodeCommandRunner({
      policy: {
        allowedExecutables: ["node"],
        cwdBoundary: workdir,
        envAllowlist: ["PATH", "HOME"]
      }
    });
    const manager = createRunManager({ runnerForProject: () => runner, bus });

    const stubPath = writeStub("fail.js", STUB_FAILURE_SCRIPT);
    const pm = fakePackageManager();
    pm.commandTemplates.playwrightTest = { executable: "node", args: [stubPath] };

    const handle = await manager.startRun({
      projectId: workdir,
      projectRoot: workdir,
      packageManager: pm,
      request: { projectId: workdir, headed: false }
    });
    const completed = await handle.finished;
    expect(completed.status).toBe("failed");
    expect(completed.exitCode).toBe(1);
  });

  it("rejects runs when packageManager.blockingExecution is true", async () => {
    const bus = createEventBus();
    const runner = createNodeCommandRunner({
      policy: {
        allowedExecutables: ["node"],
        cwdBoundary: workdir,
        envAllowlist: ["PATH"]
      }
    });
    const manager = createRunManager({ runnerForProject: () => runner, bus });

    const pm = fakePackageManager();
    pm.blockingExecution = true;
    pm.errors.push("test block");
    await expect(
      manager.startRun({
        projectId: workdir,
        projectRoot: workdir,
        packageManager: pm,
        request: { projectId: workdir, headed: false }
      })
    ).rejects.toThrow(/test block/);
  });

  it("creates a project-scoped runner for the run's projectRoot", async () => {
    const bus = createEventBus();
    const runner = createNodeCommandRunner({
      policy: {
        allowedExecutables: ["node"],
        cwdBoundary: workdir,
        envAllowlist: [
          "PATH",
          "HOME",
          "PLAYWRIGHT_JSON_OUTPUT_NAME",
          "PLAYWRIGHT_HTML_REPORT",
          "PLAYWRIGHT_HTML_OPEN"
        ]
      }
    });
    const requestedRoots: string[] = [];
    const manager = createRunManager({
      runnerForProject: (projectRoot) => {
        requestedRoots.push(projectRoot);
        return runner;
      },
      bus
    });

    const stubPath = writeStub("stub.js", STUB_SUCCESS_SCRIPT);
    const pm = fakePackageManager();
    pm.commandTemplates.playwrightTest = { executable: "node", args: [stubPath] };

    const handle = await manager.startRun({
      projectId: workdir,
      projectRoot: workdir,
      packageManager: pm,
      request: { projectId: workdir, headed: false }
    });
    await handle.finished;

    expect(requestedRoots).toEqual([workdir]);
  });
});
