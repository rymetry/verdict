import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDeployMonitor } from "../src/deploy.js";
import type { CommandResult, CommandRunner, CommandRunOptions } from "../src/githubShip.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-deploy-")));
  fs.mkdirSync(path.join(workdir, ".agents"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("runDeployMonitor", () => {
  it("skips deploy and canary when deploy config is absent", () => {
    writeConfig({});

    const result = runDeployMonitor({ projectRoot: workdir, runner: new FakeRunner([]) });

    expect(result.deploy.status).toBe("skipped");
    expect(result.canary.status).toBe("skipped");
    expect(result.summary).toBe("Deploy/Monitor skipped because no deploy config is present.");
  });

  it("blocks production deploy without explicit auto policy or approval", () => {
    writeConfig({
      deploy: {
        enabled: true,
        environment: "production",
        customCommand: ["deploy", "{environment}"]
      }
    });

    const result = runDeployMonitor({ projectRoot: workdir, runner: new FakeRunner([]) });

    expect(result.gate.allowed).toBe(false);
    expect(result.deploy.status).toBe("blocked");
    expect(result.summary).toContain("production deploy requires approval");
    expect(readTimeline()).toContain('"status":"pending"');
  });

  it("runs deploy command and canary health check after approval", () => {
    writeConfig({
      deploy: {
        enabled: true,
        environment: "production",
        productionPolicy: "approval",
        customCommand: ["deploy", "--env", "{environment}", "--task", "{taskId}"],
        healthCheckUrl: "https://example.test/health",
        canary: {
          enabled: true,
          healthCheckUrl: "https://example.test/canary"
        }
      }
    });
    const runner = new FakeRunner([
      { exitCode: 0, stdout: "deployed\n", stderr: "" },
      { exitCode: 0, stdout: "ok\n", stderr: "" },
      { exitCode: 0, stdout: "canary ok\n", stderr: "" }
    ]);

    const result = runDeployMonitor({
      projectRoot: workdir,
      taskId: "ROADMAP-1",
      approvalGranted: true,
      runner
    });

    expect(runner.calls).toEqual([
      { command: "deploy", args: ["--env", "production", "--task", "ROADMAP-1"], options: { timeoutMs: undefined } },
      { command: "curl", args: ["-fsS", "https://example.test/health"], options: { timeoutMs: undefined } },
      { command: "curl", args: ["-fsS", "https://example.test/canary"], options: { timeoutMs: undefined } }
    ]);
    expect(result.deploy.status).toBe("pass");
    expect(result.canary.status).toBe("pass");
    expect(result.summary).toBe("Deploy/Monitor completed for production.");
    expect(readTimeline()).toContain('"stage":"canary"');
    expect(readLearnings()).toContain("deploy-monitor-production");
  });

  it("keeps first URL inference for custom deploy providers", () => {
    writeConfig({
      deploy: {
        enabled: true,
        environment: "staging",
        provider: "custom-command",
        customCommand: ["deploy"],
        healthCheckUrl: "{deployUrl}",
        canary: {
          enabled: false
        }
      }
    });
    const runner = new FakeRunner([
      {
        exitCode: 0,
        stdout: "Deployed to https://preview.example.test\nDocs: https://docs.example.test\n",
        stderr: ""
      },
      { exitCode: 0, stdout: "ok\n", stderr: "" }
    ]);

    const result = runDeployMonitor({ projectRoot: workdir, taskId: "ROADMAP-1", runner });

    expect(result.deploy.deployUrl).toBe("https://preview.example.test");
    expect(runner.calls).toEqual([
      { command: "deploy", args: [], options: { timeoutMs: undefined } },
      { command: "curl", args: ["-fsS", "https://preview.example.test"], options: { timeoutMs: undefined } }
    ]);
  });

  it("runs the vercel-compatible provider and uses its deployment URL for canary", () => {
    writeConfig({
      deploy: {
        enabled: true,
        environment: "preview",
        provider: "vercel-compatible",
        canary: {
          enabled: true
        }
      }
    });
    const runner = new FakeRunner([
      {
        exitCode: 0,
        stdout:
          "Vercel CLI 99.0.0\nInspect: https://vercel.com/acme/app/abc123\nhttps://preview.example.vercel.app\n",
        stderr: ""
      },
      { exitCode: 0, stdout: "ok\n", stderr: "" }
    ]);

    const result = runDeployMonitor({ projectRoot: workdir, taskId: "ROADMAP-1", runner });

    expect(runner.calls).toEqual([
      { command: "vercel", args: ["deploy", "--yes"], options: { timeoutMs: undefined } },
      { command: "curl", args: ["-fsS", "https://preview.example.vercel.app"], options: { timeoutMs: undefined } }
    ]);
    expect(result.provider).toBe("vercel-compatible");
    expect(result.deploy.deployUrl).toBe("https://preview.example.vercel.app");
    expect(result.canary.status).toBe("pass");
  });

  it("fails canary clearly when vercel-compatible cannot infer a deploy URL", () => {
    writeConfig({
      deploy: {
        enabled: true,
        environment: "preview",
        provider: "vercel-compatible",
        canary: {
          enabled: true
        }
      }
    });
    const runner = new FakeRunner([{ exitCode: 0, stdout: "No deployment URL emitted\n", stderr: "" }]);

    const result = runDeployMonitor({ projectRoot: workdir, taskId: "ROADMAP-1", runner });

    expect(result.canary.status).toBe("fail");
    expect(result.canary.summary).toContain("requires a deploy URL");
    expect(runner.calls).toEqual([
      { command: "vercel", args: ["deploy", "--yes"], options: { timeoutMs: undefined } }
    ]);
  });

  it("fails canary clearly when a composed canary URL requires a missing deploy URL", () => {
    writeConfig({
      deploy: {
        enabled: true,
        environment: "preview",
        provider: "vercel-compatible",
        canary: {
          enabled: true,
          healthCheckUrl: "{deployUrl}/health"
        }
      }
    });
    const runner = new FakeRunner([{ exitCode: 0, stdout: "No deployment URL emitted\n", stderr: "" }]);

    const result = runDeployMonitor({ projectRoot: workdir, taskId: "ROADMAP-1", runner });

    expect(result.canary.status).toBe("fail");
    expect(result.canary.summary).toContain("requires a deploy URL");
    expect(runner.calls).toEqual([
      { command: "vercel", args: ["deploy", "--yes"], options: { timeoutMs: undefined } }
    ]);
  });

  it("does not treat a Vercel inspect URL as a deploy URL", () => {
    writeConfig({
      deploy: {
        enabled: true,
        environment: "preview",
        provider: "vercel-compatible",
        canary: {
          enabled: true
        }
      }
    });
    const runner = new FakeRunner([
      {
        exitCode: 0,
        stdout: "Inspect: https://vercel.com/acme/app/abc123\nDocs: https://nextjs.org/docs\n",
        stderr: ""
      }
    ]);

    const result = runDeployMonitor({ projectRoot: workdir, taskId: "ROADMAP-1", runner });

    expect(result.deploy.deployUrl).toBeUndefined();
    expect(result.canary.status).toBe("fail");
    expect(runner.calls).toEqual([
      { command: "vercel", args: ["deploy", "--yes"], options: { timeoutMs: undefined } }
    ]);
  });

  it("runs a custom canary command when vercel-compatible cannot infer a deploy URL", () => {
    writeConfig({
      deploy: {
        enabled: true,
        environment: "preview",
        provider: "vercel-compatible",
        canary: {
          enabled: true,
          customCommand: ["npm", "run", "canary"]
        }
      }
    });
    const runner = new FakeRunner([
      { exitCode: 0, stdout: "No deployment URL emitted\n", stderr: "" },
      { exitCode: 0, stdout: "canary ok\n", stderr: "" }
    ]);

    const result = runDeployMonitor({ projectRoot: workdir, taskId: "ROADMAP-1", runner });

    expect(result.canary.status).toBe("pass");
    expect(runner.calls).toEqual([
      { command: "vercel", args: ["deploy", "--yes"], options: { timeoutMs: undefined } },
      { command: "npm", args: ["run", "canary"], options: { timeoutMs: undefined } }
    ]);
  });

  it("fails closed for unsupported providers without a custom command", () => {
    writeConfig({
      deploy: {
        enabled: true,
        environment: "staging",
        provider: "unknown-cloud"
      }
    });

    const result = runDeployMonitor({ projectRoot: workdir, taskId: "ROADMAP-1", runner: new FakeRunner([]) });

    expect(result.provider).toBe("unsupported");
    expect(result.deploy.status).toBe("fail");
    expect(result.summary).toContain("Deploy provider is not supported");
    expect(readTimeline()).toContain('"failureClass":"UNCLASSIFIED"');
  });

  it("records canary failures as escalated CANARY_FAILURE", () => {
    writeConfig({
      deploy: {
        enabled: true,
        environment: "staging",
        customCommand: ["deploy"],
        canary: {
          enabled: true,
          customCommand: ["canary", "{stage}"]
        }
      }
    });
    const runner = new FakeRunner([
      { exitCode: 0, stdout: "deployed\n", stderr: "" },
      { exitCode: 1, stdout: "", stderr: "canary failed\n" }
    ]);

    const result = runDeployMonitor({ projectRoot: workdir, taskId: "ROADMAP-1", runner });

    expect(result.canary.status).toBe("fail");
    expect(result.canary.failureClass).toBe("CANARY_FAILURE");
    expect(readTimeline()).toContain('"failureClass":"CANARY_FAILURE"');
    const progress = JSON.parse(
      fs.readFileSync(path.join(workdir, ".agents", "state", "progress.json"), "utf8")
    );
    expect(progress.escalated[0]).toMatchObject({
      id: "ROADMAP-1:deploy",
      class: "CANARY_FAILURE"
    });
  });
});

function writeConfig(override: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(workdir, ".agents", "autonomy.config.json"),
    JSON.stringify(
      {
        version: 1,
        adapters: {
          taskSource: "markdown-roadmap",
          executor: "codex",
          verifier: "manual-verification",
          reviewer: "codex-review",
          publisher: "github-pr",
          ...(override.deploy ? { deployProvider: "custom-command" } : {})
        },
        ...override
      },
      null,
      2
    )
  );
}

function readTimeline(): string {
  return fs.readFileSync(path.join(workdir, ".agents", "state", "timeline.jsonl"), "utf8");
}

function readLearnings(): string {
  return fs.readFileSync(path.join(workdir, ".agents", "state", "learnings.jsonl"), "utf8");
}

class FakeRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: readonly string[]; options?: CommandRunOptions }> = [];
  private readonly results: CommandResult[];

  constructor(results: CommandResult[]) {
    this.results = [...results];
  }

  run(command: string, args: readonly string[], options?: CommandRunOptions): CommandResult {
    this.calls.push({ command, args, options });
    const result = this.results.shift();
    if (!result) {
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    }
    return result;
  }
}
