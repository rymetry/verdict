import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeTask } from "../src/executor.js";
import type { CommandResult, CommandRunOptions, CommandRunner } from "../src/githubShip.js";
import type { AutonomyConfig, TaskBrief } from "../src/types.js";

let workdir: string;

const task: TaskBrief = {
  id: "ROADMAP-1",
  title: "Add smoke metadata",
  deliverable: "Add smoke metadata",
  expectedScope: []
};

const config: AutonomyConfig = {
  version: 1,
  adapters: {
    taskSource: "markdown-roadmap",
    executor: "custom-command",
    verifier: "custom-command",
    reviewer: "codex-review",
    publisher: "github-pr"
  },
  executors: {
    customCommand: {
      command: ["executor", "{taskId}"],
      timeoutMs: 12_345
    }
  }
};

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-executor-")));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("executeTask", () => {
  it("passes configured timeout to the command runner", () => {
    const runner = new FakeRunner({ exitCode: 0, stdout: "ok\n", stderr: "" });

    const result = executeTask({ projectRoot: workdir, config, task, runner });

    expect(result.status).toBe("pass");
    expect(runner.calls).toEqual([
      { command: "executor", args: ["ROADMAP-1"], options: { timeoutMs: 12_345 } }
    ]);
  });

  it("uses a safe prompt filename for task ids that contain path separators", () => {
    const unsafeTask = {
      ...task,
      id: "x/../../../../tmp/pwn"
    };
    const result = executeTask({
      projectRoot: workdir,
      config,
      task: unsafeTask,
      runner: new FakeRunner({ exitCode: 0, stdout: "ok\n", stderr: "" })
    });

    expect(result.promptPath).toMatch(/^\.agents\/state\/executor-prompt-[A-Za-z0-9_-]+\.md$/);
    expect(result.promptPath).not.toContain("..");
    expect(fs.existsSync(path.join(workdir, result.promptPath))).toBe(true);
  });

  it("records PR completion metadata when the executor emits structured JSON", () => {
    const result = executeTask({
      projectRoot: workdir,
      config,
      task,
      runner: new FakeRunner({
        exitCode: 0,
        stdout: [
          "implemented task",
          JSON.stringify({
            prNumber: 123,
            prUrl: "https://github.com/rymetry/verdict/pull/123",
            branch: "codex/roadmap-1",
            tests: ["pnpm --filter @rymetry/agent-autonomy test"],
            summary: "Opened PR for ROADMAP-1"
          })
        ].join("\n"),
        stderr: ""
      })
    });

    expect(result).toMatchObject({
      status: "pass",
      prNumber: 123,
      prUrl: "https://github.com/rymetry/verdict/pull/123",
      branch: "codex/roadmap-1",
      summary: "Opened PR for ROADMAP-1"
    });
    const progress = JSON.parse(fs.readFileSync(path.join(workdir, ".agents", "state", "progress.json"), "utf8"));
    expect(progress.active).toMatchObject({
      id: "ROADMAP-1",
      pr_number: 123,
      branch: "codex/roadmap-1",
      stage: "ship"
    });
  });

  it("classifies timed-out executor commands as CODEX_HANG", () => {
    const result = executeTask({
      projectRoot: workdir,
      config,
      task,
      runner: new FakeRunner({
        exitCode: 1,
        stdout: "",
        stderr: "spawnSync executor ETIMEDOUT",
        timedOut: true
      })
    });

    expect(result).toMatchObject({
      status: "fail",
      failureClass: "CODEX_HANG"
    });
    expect(fs.readFileSync(path.join(workdir, ".agents", "state", "timeline.jsonl"), "utf8")).toContain(
      '"failureClass":"CODEX_HANG"'
    );
  });
});

class FakeRunner implements CommandRunner {
  readonly calls: Array<{
    command: string;
    args: readonly string[];
    options?: CommandRunOptions;
  }> = [];

  constructor(private readonly result: CommandResult) {}

  run(command: string, args: readonly string[], options?: CommandRunOptions): CommandResult {
    this.calls.push({ command, args, options });
    return this.result;
  }
}
