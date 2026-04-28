import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unsafelyAllowAnyArgsValidator } from "../src/commands/policy.js";
import { createNodeCommandRunner } from "../src/commands/runner.js";
import { createEventBus, type EventBus } from "../src/events/bus.js";
import { createRunManager } from "../src/playwright/runManager.js";
import { runArtifactsStore } from "../src/playwright/runArtifactsStore.js";
import {
  RunCompletedPayloadSchema,
  RunErrorPayloadSchema,
  type DetectedPackageManager,
  type WorkbenchEvent,
  type WorkbenchEventInput
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
  vi.restoreAllMocks();
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
        argValidator: unsafelyAllowAnyArgsValidator,
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
    const completedEvent = events.find((event) => event.type === "run.completed");
    const payload = RunCompletedPayloadSchema.parse(completedEvent?.payload);
    expect(payload.warnings).toEqual([]);
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
        argValidator: unsafelyAllowAnyArgsValidator,
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

  it("publishes final warnings in terminal events", async () => {
    const bus = createEventBus();
    const runner = createNodeCommandRunner({
      policy: {
        allowedExecutables: ["node"],
        argValidator: unsafelyAllowAnyArgsValidator,
        cwdBoundary: workdir,
        envAllowlist: ["PATH", "HOME"]
      }
    });
    const manager = createRunManager({
      runnerForProject: () => runner,
      bus,
      reportProvider: {
        name: "test-provider",
        async readSummary() {
          throw Object.assign(new Error("summary path /private/result.json"), {
            code: "EACCES"
          });
        }
      }
    });
    const events: WorkbenchEvent[] = [];
    bus.subscribe((event) => events.push(event));

    const stubPath = writeStub("fail-with-summary-warning.js", STUB_FAILURE_SCRIPT);
    const pm = fakePackageManager();
    pm.commandTemplates.playwrightTest = { executable: "node", args: [stubPath] };

    const handle = await manager.startRun({
      projectId: workdir,
      projectRoot: workdir,
      packageManager: pm,
      request: { projectId: workdir, headed: false }
    });
    const completed = await handle.finished;
    const terminal = events.find((event) => event.type === "run.completed");
    const payload = RunCompletedPayloadSchema.parse(terminal?.payload);

    expect(completed.warnings.join("\n")).toContain("test-provider report read failed");
    expect(payload.warnings).toEqual(completed.warnings);
    expect(payload.warnings.join("\n")).toContain("code=EACCES");
    expect(payload.warnings.join("\n")).not.toContain("/private/result.json");
  });

  it("records stdout and stderr log write failures independently", async () => {
    const bus = createEventBus();
    const runner = {
      run(_spec: unknown, handlers = {}) {
        const streamHandlers = handlers as {
          onStdout?: (chunk: string) => void;
          onStderr?: (chunk: string) => void;
        };
        streamHandlers.onStdout?.("hello ");
        streamHandlers.onStdout?.("world");
        streamHandlers.onStderr?.("warn");
        return {
          result: Promise.resolve({
            exitCode: 0,
            signal: null,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: 1,
            stdout: "hello world",
            stderr: "warn",
            cancelled: false,
            timedOut: false,
            command: { executable: "node", args: [], cwd: workdir }
          }),
          cancel() {}
        };
      }
    };
    const errors: Array<Record<string, unknown>> = [];
    const manager = createRunManager({
      runnerForProject: () => runner,
      bus,
      artifactsStore: {
        ...runArtifactsStore,
        async openLogStreams(stdoutPath, stderrPath) {
          const streams = await runArtifactsStore.openLogStreams(stdoutPath, stderrPath);
          let stdoutWrites = 0;
          return {
            ...streams,
            stdout: {
              ...streams.stdout,
              write: async () => {
                stdoutWrites += 1;
                throw Object.assign(new Error("disk full at /private/stdout.log"), {
                  code: stdoutWrites === 1 ? "ENOSPC" : "EACCES"
                });
              }
            } as never,
            stderr: {
              ...streams.stderr,
              write: async () => {
                throw Object.assign(new Error("bad fd at /private/stderr.log"), {
                  code: "EBADF"
                });
              }
            } as never
          };
        }
      },
      reportProvider: {
        name: "test-provider",
        async readSummary() {
          return undefined;
        }
      },
      logger: {
        error(payload) {
          errors.push(payload);
        }
      }
    });
    const events: WorkbenchEvent[] = [];
    bus.subscribe((event) => events.push(event));

    const pm = fakePackageManager();

    const handle = await manager.startRun({
      projectId: workdir,
      projectRoot: workdir,
      packageManager: pm,
      request: { projectId: workdir, headed: false }
    });
    const completed = await handle.finished;

    expect(events.some((event) => event.type === "run.stdout")).toBe(true);
    expect(events.some((event) => event.type === "run.stderr")).toBe(true);
    const warningText = completed.warnings.join("\n");
    expect(warningText).toContain("stdout log write failed");
    expect(warningText).toContain("code=ENOSPC");
    expect(warningText).toContain("codes=ENOSPC,EACCES");
    expect(warningText).toContain("failures=2");
    expect(warningText).toContain("stderr log write failed");
    expect(warningText).toContain("code=EBADF");
    expect(warningText).not.toContain("/private/stdout.log");
    expect(warningText).not.toContain("/private/stderr.log");
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: handle.runId,
        stream: "stdout",
        artifactKind: "log",
        code: "ENOSPC",
        err: "disk full at /private/stdout.log"
      }),
      expect.objectContaining({
        runId: handle.runId,
        stream: "stdout",
        artifactKind: "log",
        code: "EACCES",
        err: "disk full at /private/stdout.log"
      }),
      expect.objectContaining({
        runId: handle.runId,
        stream: "stderr",
        artifactKind: "log",
        code: "EBADF",
        err: "bad fd at /private/stderr.log"
      })
    ]));
    expect(errors).toHaveLength(3);
  });

  it("does not let stream publish validation failures escape runner callbacks", async () => {
    const published: WorkbenchEventInput[] = [];
    const bus: EventBus = {
      publish(event: WorkbenchEventInput) {
        published.push(event);
        if (event.type === "run.stdout" || event.type === "run.stderr") {
          throw Object.assign(new Error(`invalid ${event.type} payload`), {
            code: "PAYLOAD_VALIDATION_FAILED"
          });
        }
        return { ...event, sequence: published.length, timestamp: new Date().toISOString() } as WorkbenchEvent;
      },
      subscribe() {
        return () => undefined;
      },
      snapshot() {
        return [];
      }
    };
    const runner = {
      run(_spec: unknown, handlers = {}) {
        const streamHandlers = handlers as {
          onStdout?: (chunk: string) => void;
          onStderr?: (chunk: string) => void;
        };
        expect(() => streamHandlers.onStdout?.("hello")).not.toThrow();
        expect(() => streamHandlers.onStderr?.("warn")).not.toThrow();
        return {
          result: Promise.resolve({
            exitCode: 0,
            signal: null,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: 1,
            stdout: "hello",
            stderr: "warn",
            cancelled: false,
            timedOut: false,
            command: { executable: "node", args: [], cwd: workdir }
          }),
          cancel() {}
        };
      }
    };
    const errors: Array<Record<string, unknown>> = [];
    const manager = createRunManager({
      runnerForProject: () => runner,
      bus,
      reportProvider: {
        name: "test-provider",
        async readSummary() {
          return undefined;
        }
      },
      logger: {
        error(payload) {
          errors.push(payload);
        }
      }
    });

    const handle = await manager.startRun({
      projectId: workdir,
      projectRoot: workdir,
      packageManager: fakePackageManager(),
      request: { projectId: workdir, headed: false }
    });
    const completed = await handle.finished;

    expect(completed.status).toBe("passed");
    expect(completed.warnings.join("\n")).toContain("stdout websocket delivery failed");
    expect(completed.warnings.join("\n")).toContain("stderr websocket delivery failed");
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: handle.runId,
        eventType: "run.stdout",
        code: "PAYLOAD_VALIDATION_FAILED"
      }),
      expect.objectContaining({
        runId: handle.runId,
        eventType: "run.stderr",
        code: "PAYLOAD_VALIDATION_FAILED"
      })
    ]));
  });

  it("replaces chunks when stream redaction fails and surfaces a sanitized warning", async () => {
    const secret = "token=ghp_abcdefghijklmnopqrstuvwxyz1234";
    const published: WorkbenchEventInput[] = [];
    const bus: EventBus = {
      publish(event: WorkbenchEventInput) {
        published.push(event);
        return { ...event, sequence: published.length, timestamp: new Date().toISOString() } as WorkbenchEvent;
      },
      subscribe() {
        return () => undefined;
      },
      snapshot() {
        return [];
      }
    };
    const runner = {
      run(_spec: unknown, handlers = {}) {
        const streamHandlers = handlers as { onStdout?: (chunk: string) => void };
        streamHandlers.onStdout?.(`leaky ${secret}\n`);
        return {
          result: Promise.resolve({
            exitCode: 0,
            signal: null,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: 1,
            stdout: "",
            stderr: "",
            cancelled: false,
            timedOut: false,
            command: { executable: "node", args: [], cwd: workdir }
          }),
          cancel() {}
        };
      }
    };
    const errors: Array<Record<string, unknown>> = [];
    const manager = createRunManager({
      runnerForProject: () => runner,
      bus,
      redactor: () => {
        throw Object.assign(new Error(`redaction failed for ${secret}`), {
          code: "REDACT_FAILED"
        });
      },
      reportProvider: {
        name: "test-provider",
        async readSummary() {
          return undefined;
        }
      },
      logger: {
        error(payload) {
          errors.push(payload);
        }
      }
    });

    const handle = await manager.startRun({
      projectId: workdir,
      projectRoot: workdir,
      packageManager: fakePackageManager(),
      request: { projectId: workdir, headed: false }
    });
    const completed = await handle.finished;
    const stdoutEvent = published.find((event) => event.type === "run.stdout");
    const terminal = published.find((event) => event.type === "run.completed");
    const payload = RunCompletedPayloadSchema.parse(terminal?.payload);
    const stdoutLog = fs.readFileSync(
      path.join(workdir, ".playwright-workbench", "runs", handle.runId, "stdout.log"),
      "utf8"
    );
    const combined = JSON.stringify({ completed, payload, stdoutEvent, stdoutLog, errors });

    expect(stdoutEvent?.payload).toEqual({ chunk: "[redaction failed]\n" });
    expect(stdoutLog).toBe("[redaction failed]\n");
    expect(payload.warnings.join("\n")).toContain("stdout redaction failed");
    expect(payload.warnings.join("\n")).toContain("code=REDACT_FAILED");
    expect(combined).not.toContain(secret);
    expect(errors).toEqual([
      expect.objectContaining({
        runId: handle.runId,
        stream: "stdout",
        artifactKind: "stream-redaction",
        code: "REDACT_FAILED",
        errorName: "Error"
      })
    ]);
  });

  it("emits a sanitized run.error fallback when terminal completion publish fails", async () => {
    const published: WorkbenchEventInput[] = [];
    const bus: EventBus = {
      publish(event: WorkbenchEventInput) {
        published.push(event);
        if (event.type === "run.completed") {
          throw new Error("terminal schema drift at /private/path");
        }
        return { ...event, sequence: published.length, timestamp: new Date().toISOString() } as WorkbenchEvent;
      },
      subscribe() {
        return () => undefined;
      },
      snapshot() {
        return [];
      }
    };
    const runner = {
      run() {
        return {
          result: Promise.resolve({
            exitCode: 0,
            signal: null,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: 1,
            stdout: "",
            stderr: "",
            cancelled: false,
            timedOut: false,
            command: { executable: "node", args: [], cwd: workdir }
          }),
          cancel() {}
        };
      }
    };
    const manager = createRunManager({
      runnerForProject: () => runner,
      bus,
      reportProvider: {
        name: "test-provider",
        async readSummary() {
          return undefined;
        }
      }
    });

    const handle = await manager.startRun({
      projectId: workdir,
      projectRoot: workdir,
      packageManager: fakePackageManager(),
      request: { projectId: workdir, headed: false }
    });
    const completed = await handle.finished;

    expect(completed.status).toBe("passed");
    const fallback = published.find((event) => event.type === "run.error");
    expect(fallback).toBeDefined();
    const payload = RunErrorPayloadSchema.parse(fallback?.payload);
    expect(payload.message).toBe("Terminal event could not be delivered.");
    expect(payload.warnings.join("\n")).toContain(
      "Terminal event could not be delivered. code=UNKNOWN; originalEvent=run.completed; originalStatus=passed"
    );
    expect(payload.warnings.join("\n")).not.toContain("/private/path");
  });

  it("falls back even when the original terminal event is run.error", async () => {
    let firstRunError = true;
    const published: WorkbenchEventInput[] = [];
    const bus: EventBus = {
      publish(event: WorkbenchEventInput) {
        published.push(event);
        if (event.type === "run.error" && firstRunError) {
          firstRunError = false;
          throw Object.assign(new Error("invalid original run.error"), {
            code: "PAYLOAD_VALIDATION_FAILED"
          });
        }
        return { ...event, sequence: published.length, timestamp: new Date().toISOString() } as WorkbenchEvent;
      },
      subscribe() {
        return () => undefined;
      },
      snapshot() {
        return [];
      }
    };
    const runner = {
      run() {
        return {
          result: Promise.resolve({
            exitCode: 1,
            signal: null,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: 1,
            stdout: "",
            stderr: "",
            cancelled: false,
            timedOut: true,
            command: { executable: "node", args: [], cwd: workdir }
          }),
          cancel() {}
        };
      }
    };
    const manager = createRunManager({
      runnerForProject: () => runner,
      bus,
      reportProvider: {
        name: "test-provider",
        async readSummary() {
          return undefined;
        }
      }
    });

    const handle = await manager.startRun({
      projectId: workdir,
      projectRoot: workdir,
      packageManager: fakePackageManager(),
      request: { projectId: workdir, headed: false }
    });
    const completed = await handle.finished;

    expect(completed.status).toBe("error");
    const runErrors = published.filter((event) => event.type === "run.error");
    expect(runErrors).toHaveLength(2);
    const payload = RunErrorPayloadSchema.parse(runErrors[1]?.payload);
    expect(payload.warnings.join("\n")).toContain(
      "Terminal event could not be delivered. code=PAYLOAD_VALIDATION_FAILED; originalEvent=run.error; originalStatus=error"
    );
  });

  it("emits a process warning when original and fallback terminal publishes both fail", async () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    const errors: Array<{ payload: Record<string, unknown>; message: string }> = [];
    const bus: EventBus = {
      publish(event: WorkbenchEventInput) {
        if (event.type === "run.completed" || event.type === "run.error") {
          throw Object.assign(new Error("publish unavailable"), {
            code: "PAYLOAD_VALIDATION_FAILED"
          });
        }
        return { ...event, sequence: 1, timestamp: new Date().toISOString() } as WorkbenchEvent;
      },
      subscribe() {
        return () => undefined;
      },
      snapshot() {
        return [];
      }
    };
    const runner = {
      run() {
        return {
          result: Promise.resolve({
            exitCode: 0,
            signal: null,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: 1,
            stdout: "",
            stderr: "",
            cancelled: false,
            timedOut: false,
            command: { executable: "node", args: [], cwd: workdir }
          }),
          cancel() {}
        };
      }
    };
    const manager = createRunManager({
      runnerForProject: () => runner,
      bus,
      reportProvider: {
        name: "test-provider",
        async readSummary() {
          return undefined;
        }
      },
      logger: {
        error(payload, message) {
          errors.push({ payload, message });
        }
      }
    });

    const handle = await manager.startRun({
      projectId: workdir,
      projectRoot: workdir,
      packageManager: fakePackageManager(),
      request: { projectId: workdir, headed: false }
    });
    await expect(handle.finished).resolves.toEqual(expect.objectContaining({ status: "passed" }));

    expect(emitWarning).toHaveBeenCalledWith("Terminal fallback event publish failed", {
      code: "PWQA_TERMINAL_FALLBACK_PUBLISH_FAILED"
    });
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: "terminal fallback publish exhausted; UI may remain running",
        payload: expect.objectContaining({
          runId: handle.runId,
          originalEvent: "run.error",
          originalStatus: "error",
          code: "PAYLOAD_VALIDATION_FAILED"
        })
      })
    ]));
  });

  it("keeps websocket stdout delivery when real runner log persistence fails", async () => {
    const bus = createEventBus();
    const runner = createNodeCommandRunner({
      policy: {
        allowedExecutables: ["node"],
        argValidator: unsafelyAllowAnyArgsValidator,
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
    const manager = createRunManager({
      runnerForProject: () => runner,
      bus,
      artifactsStore: {
        ...runArtifactsStore,
        async openLogStreams(stdoutPath, stderrPath) {
          const streams = await runArtifactsStore.openLogStreams(stdoutPath, stderrPath);
          return {
            ...streams,
            stdout: {
              ...streams.stdout,
              write: async () => {
                throw Object.assign(new Error("disk full at /private/stdout.log"), {
                  code: "ENOSPC"
                });
              }
            } as never
          };
        }
      }
    });
    const events: WorkbenchEvent[] = [];
    bus.subscribe((event) => events.push(event));

    const stubPath = writeStub("stdout-write-fails.js", STUB_SUCCESS_SCRIPT);
    const pm = fakePackageManager();
    pm.commandTemplates.playwrightTest = { executable: "node", args: [stubPath] };

    const handle = await manager.startRun({
      projectId: workdir,
      projectRoot: workdir,
      packageManager: pm,
      request: { projectId: workdir, headed: false }
    });
    const completed = await handle.finished;

    expect(events.some((event) => event.type === "run.stdout")).toBe(true);
    expect(completed.warnings.join("\n")).toContain("stdout log write failed");
    expect(completed.warnings.join("\n")).toContain("code=ENOSPC");
  });

  it("rejects runs when packageManager.blockingExecution is true", async () => {
    const bus = createEventBus();
    const runner = createNodeCommandRunner({
      policy: {
        allowedExecutables: ["node"],
        argValidator: unsafelyAllowAnyArgsValidator,
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
        argValidator: unsafelyAllowAnyArgsValidator,
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

  it("summarises only redacted Playwright JSON so secrets never reach metadata or WS", async () => {
    const bus = createEventBus();
    const runner = createNodeCommandRunner({
      policy: {
        allowedExecutables: ["node"],
        argValidator: unsafelyAllowAnyArgsValidator,
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

    const stubPath = writeStub(
      "secret-json.js",
      `
const fs = require('node:fs');
const path = require('node:path');
const report = process.env.PLAYWRIGHT_JSON_OUTPUT_NAME;
fs.mkdirSync(path.dirname(report), { recursive: true });
fs.writeFileSync(report, JSON.stringify({
  stats: { expected: 0, unexpected: 1, flaky: 0, skipped: 0, duration: 1 },
  suites: [{
    title: 'suite',
    file: 'tests/secret.spec.ts',
    specs: [{
      title: 'leaks token',
      file: 'tests/secret.spec.ts',
      line: 7,
      tests: [{
        id: 'secret-test',
        status: 'failed',
        results: [{
          status: 'failed',
          duration: 1,
          error: {
            message: 'token=ghp_abcdefghijklmnopqrstuvwxyz1234',
            stack: 'Authorization: Bearer abcdefghijklmnop123456'
          }
        }]
      }]
    }]
  }]
}));
process.exit(1);
`
    );
    const pm = fakePackageManager();
    pm.commandTemplates.playwrightTest = { executable: "node", args: [stubPath] };

    const handle = await manager.startRun({
      projectId: workdir,
      projectRoot: workdir,
      packageManager: pm,
      request: { projectId: workdir, headed: false }
    });
    const completed = await handle.finished;
    const terminal = events.find((event) => event.type === "run.completed");
    const payload = RunCompletedPayloadSchema.parse(terminal?.payload);
    const metadataFailure = completed.summary?.failedTests[0];
    const wsFailure = payload.summary?.failedTests[0];

    expect(metadataFailure?.message).toContain("<REDACTED>");
    expect(metadataFailure?.stack).toContain("<REDACTED>");
    expect(wsFailure?.message).toBe(metadataFailure?.message);
    expect(wsFailure?.stack).toBe(metadataFailure?.stack);
    expect(JSON.stringify(completed.summary)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz1234");
    expect(JSON.stringify(payload.summary)).not.toContain("abcdefghijklmnop123456");
  });

  it("removes raw Playwright JSON and records a warning when redaction fails", async () => {
    const bus = createEventBus();
    const runner = createNodeCommandRunner({
      policy: {
        allowedExecutables: ["node"],
        argValidator: unsafelyAllowAnyArgsValidator,
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
    const errors: Array<Record<string, unknown>> = [];
    const manager = createRunManager({
      runnerForProject: () => runner,
      bus,
      artifactsStore: {
        ...runArtifactsStore,
        async redactPlaywrightResults() {
          throw new Error("redaction disk write failed");
        }
      },
      logger: {
        error(payload) {
          errors.push(payload);
        }
      }
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
    const completed = await handle.finished;

    expect(fs.existsSync(completed.paths.playwrightJson)).toBe(false);
    expect(completed.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Playwright JSON redaction failed")
      ])
    );
    expect(completed.warnings.join("\n")).not.toContain("redaction disk write failed");
    expect(completed.warnings.join("\n")).not.toContain(workdir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: handle.runId,
          err: "redaction disk write failed",
          code: "UNKNOWN",
          playwrightJsonPath: completed.paths.playwrightJson
        }),
        expect.objectContaining({
          runId: handle.runId,
          provider: "playwright-json",
          artifactKind: "playwright-json-summary",
          code: "ENOENT"
        })
      ])
    );
  });

  it("does not claim raw Playwright JSON was removed when cleanup fails", async () => {
    const bus = createEventBus();
    const runner = createNodeCommandRunner({
      policy: {
        allowedExecutables: ["node"],
        argValidator: unsafelyAllowAnyArgsValidator,
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
    const manager = createRunManager({
      runnerForProject: () => runner,
      bus,
      artifactsStore: {
        ...runArtifactsStore,
        async redactPlaywrightResults(playwrightJsonPath) {
          fs.rmSync(playwrightJsonPath, { force: true });
          throw Object.assign(new Error("redaction disk write failed at /private/path"), {
            code: "EACCES"
          });
        }
      }
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
    const completed = await handle.finished;
    const warningText = completed.warnings.join("\n");

    expect(warningText).toContain("raw result artifact may still contain secrets");
    expect(warningText).toContain("redactionCode=EACCES");
    expect(warningText).toContain("removalCode=ENOENT");
    expect(warningText).not.toContain("/private/path");
    expect(warningText).not.toContain(completed.paths.playwrightJson);
  });

  it("publishes run.error payloads with terminal warning fields", async () => {
    const bus = createEventBus();
    const manager = createRunManager({
      runnerForProject: () => ({
        run() {
          throw Object.assign(new Error("policy path /private/project"), {
            code: "COMMAND_POLICY"
          });
        }
      }),
      bus
    });
    const events: WorkbenchEvent[] = [];
    bus.subscribe((event) => events.push(event));
    const pm = fakePackageManager();
    pm.commandTemplates.playwrightTest = { executable: "node", args: ["stub.js"] };

    await expect(
      manager.startRun({
        projectId: workdir,
        projectRoot: workdir,
        packageManager: pm,
        request: { projectId: workdir, headed: false }
      })
    ).rejects.toThrow(/policy path/);

    const errorEvent = events.find((event) => event.type === "run.error");
    const payload = RunErrorPayloadSchema.parse(errorEvent?.payload);
    expect(payload.status).toBe("error");
    expect(payload.warnings.join("\n")).toContain("code=COMMAND_POLICY");
    expect(payload.warnings.join("\n")).not.toContain("/private/project");
  });

  it("logs corrupted persisted metadata but quietly skips missing metadata", async () => {
    const { loadRunsFromDisk } = await import("../src/playwright/runManager.js");
    const runsRoot = path.join(workdir, ".playwright-workbench", "runs");
    fs.mkdirSync(path.join(runsRoot, "missing-metadata"), { recursive: true });
    fs.mkdirSync(path.join(runsRoot, "bad-json"), { recursive: true });
    fs.mkdirSync(path.join(runsRoot, "metadata-dir", "metadata.json"), { recursive: true });
    fs.writeFileSync(path.join(runsRoot, "bad-json", "metadata.json"), "{not json");
    const warnings: Array<Record<string, unknown>> = [];

    const runs = await loadRunsFromDisk(workdir, {
      error() {},
      warn(payload) {
        warnings.push(payload);
      }
    });

    expect(runs).toEqual([]);
    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runDir: "bad-json",
        artifactKind: "metadata",
        reason: "invalid-json",
        code: "INVALID_JSON"
      }),
      expect.objectContaining({
        runDir: "metadata-dir",
        artifactKind: "metadata",
        reason: "not-file"
      })
    ]));
    expect(warnings).toHaveLength(2);
  });

  it("logs runs directory list failures except for missing runs directory", async () => {
    const { loadRunsFromDisk } = await import("../src/playwright/runManager.js");
    const warnings: Array<Record<string, unknown>> = [];

    await expect(
      loadRunsFromDisk(path.join(workdir, "missing-project"), {
        error() {},
        warn(payload) {
          warnings.push(payload);
        }
      })
    ).resolves.toEqual([]);

    expect(warnings).toEqual([]);

    const brokenRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-runmgr-broken-runs-")));
    try {
      fs.mkdirSync(path.join(brokenRoot, ".playwright-workbench"), { recursive: true });
      fs.writeFileSync(path.join(brokenRoot, ".playwright-workbench", "runs"), "not a dir");

      await expect(
        loadRunsFromDisk(brokenRoot, {
          error() {},
          warn(payload) {
            warnings.push(payload);
          }
        })
      ).resolves.toEqual([]);

      expect(warnings).toEqual([
        expect.objectContaining({
          artifactKind: "runs-directory",
          code: "ENOTDIR"
        })
      ]);
    } finally {
      fs.rmSync(brokenRoot, { recursive: true, force: true });
    }
  });
});
