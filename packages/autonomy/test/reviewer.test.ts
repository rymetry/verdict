import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runStructuredReview } from "../src/reviewer.js";
import type { AutonomyConfig } from "../src/types.js";
import type { CommandResult, CommandRunner, CommandRunOptions } from "../src/githubShip.js";

let workdir: string;

const baseConfig: AutonomyConfig = {
  version: 1,
  adapters: {
    taskSource: "markdown-roadmap",
    executor: "codex",
    verifier: "custom-command",
    reviewer: "custom-command",
    publisher: "github-pr"
  }
};

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-review-")));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("runStructuredReview", () => {
  it("runs a configured review command and records structured output", () => {
    const runner = new FakeRunner({
      exitCode: 0,
      stdout: `${JSON.stringify({
        expectedReviewers: ["architecture", "test"],
        reviews: [
          { reviewer: "architecture", status: "pass", findings: [], summary: "ok" },
          { reviewer: "test", status: "pass", findings: [], summary: "ok" }
        ]
      })}\n`,
      stderr: ""
    });
    const result = runStructuredReview({
      projectRoot: workdir,
      config: {
        ...baseConfig,
        reviewers: { customCommand: { command: ["reviewer", "--pr", "{prNumber}"], timeoutMs: 45_000 } }
      },
      prNumber: 123,
      runner
    });

    expect(runner.calls).toEqual([
      { command: "reviewer", args: ["--pr", "123"], options: { timeoutMs: 45_000 } }
    ]);
    expect(result.reviewFile).toBe(".agents/state/review-123.json");
    expect(result.reviewInput.expectedReviewers).toEqual(["architecture", "test"]);
    expect(result.reviewInput.reviews).toHaveLength(2);
    expect(fs.readFileSync(path.join(workdir, ".agents", "state", "timeline.jsonl"), "utf8")).toContain(
      '"status":"pass"'
    );
  });

  it("writes an explicit pending operator review when no command is configured", () => {
    const result = runStructuredReview({
      projectRoot: workdir,
      config: {
        ...baseConfig,
        reviewers: { customCommand: { expectedReviewers: ["security", "product"] } }
      },
      prNumber: 124,
      runner: new FakeRunner({ exitCode: 0, stdout: "", stderr: "" })
    });

    expect(result.reviewInput.expectedReviewers).toEqual(["security", "product"]);
    expect(result.reviewInput.reviews).toEqual([
      {
        reviewer: "security",
        status: "pending",
        findings: [],
        summary: "Review command is not configured."
      },
      {
        reviewer: "product",
        status: "pending",
        findings: [],
        summary: "Review command is not configured."
      }
    ]);
    expect(fs.readFileSync(path.join(workdir, ".agents", "state", "timeline.jsonl"), "utf8")).toContain(
      '"status":"pending"'
    );
  });

  it("classifies review command failures", () => {
    expect(() =>
      runStructuredReview({
        projectRoot: workdir,
        config: {
          ...baseConfig,
          reviewers: { customCommand: { command: ["reviewer", "--pr", "{prNumber}"] } }
        },
        prNumber: 125,
        runner: new FakeRunner({
          exitCode: 1,
          stdout: "",
          stderr: "Authentication failed for gh"
        })
      })
    ).toThrow(/Authentication failed/);

    const timeline = fs.readFileSync(path.join(workdir, ".agents", "state", "timeline.jsonl"), "utf8");
    const progress = JSON.parse(fs.readFileSync(path.join(workdir, ".agents", "state", "progress.json"), "utf8"));
    expect(timeline).toContain('"failureClass":"TOOL_AUTH_FAILURE"');
    expect(progress.escalated[0]).toMatchObject({
      id: "PR-125:review",
      class: "TOOL_AUTH_FAILURE"
    });
  });
});

class FakeRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: readonly string[]; options?: CommandRunOptions }> = [];

  constructor(private readonly result: CommandResult) {}

  run(command: string, args: readonly string[], options?: CommandRunOptions): CommandResult {
    this.calls.push({ command, args, options });
    return this.result;
  }
}
