import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CommandPolicyError,
  createNodeCommandRunner,
  type CommandPolicy
} from "../src/commands/runner.js";
import { allowAnyArgsValidator } from "../src/commands/policy.js";
import { redact } from "../src/commands/redact.js";

let workdir: string;

beforeAll(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-runner-")));
});
afterAll(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

function basePolicy(): CommandPolicy {
  return {
    allowedExecutables: ["node"],
    argValidator: allowAnyArgsValidator,
    cwdBoundary: workdir,
    envAllowlist: ["PATH", "HOME"]
  };
}

describe("NodeCommandRunner", () => {
  it("captures stdout from a node child process", async () => {
    const runner = createNodeCommandRunner({ policy: basePolicy() });
    const handle = runner.run({
      executable: "node",
      args: ["-e", "process.stdout.write('hello')"],
      cwd: workdir
    });
    const result = await handle.result;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello");
    expect(result.cancelled).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  it("streams stdout chunks via handler", async () => {
    const runner = createNodeCommandRunner({ policy: basePolicy() });
    const chunks: string[] = [];
    const handle = runner.run(
      {
        executable: "node",
        args: ["-e", "process.stdout.write('a'); process.stdout.write('b')"],
        cwd: workdir
      },
      { onStdout: (chunk) => chunks.push(chunk) }
    );
    const result = await handle.result;
    expect(result.exitCode).toBe(0);
    expect(chunks.join("")).toBe("ab");
  });

  it("returns non-zero exit code without throwing", async () => {
    const runner = createNodeCommandRunner({ policy: basePolicy() });
    const handle = runner.run({
      executable: "node",
      args: ["-e", "process.exit(7)"],
      cwd: workdir
    });
    const result = await handle.result;
    expect(result.exitCode).toBe(7);
  });

  it("rejects executables outside the allowlist", () => {
    const runner = createNodeCommandRunner({ policy: basePolicy() });
    expect(() =>
      runner.run({
        executable: "/bin/sh",
        args: ["-c", "echo hi"],
        cwd: workdir
      })
    ).toThrow(CommandPolicyError);
  });

  it("blocks cwd outside the project boundary", () => {
    const policy = basePolicy();
    const runner = createNodeCommandRunner({ policy });
    expect(() =>
      runner.run({
        executable: "node",
        args: ["-e", "0"],
        cwd: os.tmpdir()
      })
    ).toThrow(CommandPolicyError);
  });

  it("times out long running processes", async () => {
    const runner = createNodeCommandRunner({ policy: basePolicy() });
    const handle = runner.run({
      executable: "node",
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: workdir,
      timeoutMs: 100
    });
    const result = await handle.result;
    expect(result.timedOut).toBe(true);
  });

  it("cancellation marks cancelled and terminates", async () => {
    const runner = createNodeCommandRunner({ policy: basePolicy() });
    const handle = runner.run({
      executable: "node",
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: workdir
    });
    setTimeout(() => handle.cancel("user-request"), 50);
    const result = await handle.result;
    expect(result.cancelled).toBe(true);
  });

  it("filters env to the allowlist", async () => {
    const runner = createNodeCommandRunner({ policy: basePolicy() });
    const handle = runner.run({
      executable: "node",
      args: ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))"],
      cwd: workdir,
      env: { PATH: process.env.PATH ?? "", SECRET_TOKEN: "leak", HOME: "/tmp" }
    });
    const result = await handle.result;
    const keys = JSON.parse(result.stdout) as string[];
    expect(keys).toContain("PATH");
    expect(keys).toContain("HOME");
    expect(keys).not.toContain("SECRET_TOKEN");
  });

  it("redacts common secret patterns", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop123456")).toContain("<REDACTED>");
    expect(redact("token=ghp_abcdefghijklmnopqrstuvwxyz1234")).toContain("<REDACTED>");
  });
});
