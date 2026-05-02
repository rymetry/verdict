import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shipPullRequest, type CommandResult, type CommandRunner } from "../src/githubShip.js";
import { createInitialProgress, writeProgress } from "../src/state.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-github-ship-")));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("shipPullRequest", () => {
  it("blocks before merge when review approval is missing", () => {
    const runner = new FakeRunner([
      ghView({
        state: "OPEN",
        checks: [{ name: "verify", workflowName: "CI", status: "COMPLETED", conclusion: "SUCCESS" }]
      }),
      command({ stdout: "" })
    ]);

    const result = shipPullRequest({
      projectRoot: workdir,
      prNumber: 104,
      qa: "pass",
      scope: "pass",
      runner
    });

    expect(result.merged).toBe(false);
    expect(result.gate).toMatchObject({
      allowed: false,
      reasons: ["operator-review review is pending"]
    });
    expect(runner.calls.map((call) => call.join(" "))).toEqual([
      "gh pr view 104 --json number,state,url,mergeCommit,statusCheckRollup",
      "git status --short"
    ]);
  });

  it("auto-merges with merge fallback and records Ship learnings", () => {
    writeProgress(workdir, createInitialProgress(new Date("2026-05-02T00:00:00.000Z")));
    const runner = new FakeRunner([
      ghView({
        state: "OPEN",
        checks: [
          { name: "verify", workflowName: "CI", status: "COMPLETED", conclusion: "SUCCESS" },
          {
            name: "auto-merge",
            workflowName: "Dependabot Auto-Merge",
            status: "COMPLETED",
            conclusion: "SKIPPED"
          }
        ]
      }),
      command({ stdout: "" }),
      command({ exitCode: 1, stderr: "GraphQL: Squash merges are not allowed on this repository." }),
      ghView({ state: "OPEN" }),
      command({
        exitCode: 1,
        stderr: "failed to run git: fatal: 'main' is already used by worktree at '/repo'"
      }),
      ghView({ state: "MERGED", mergeCommitOid: "abc123" })
    ]);

    const result = shipPullRequest({
      projectRoot: workdir,
      prNumber: 104,
      taskId: "T1500-6",
      autoMerge: true,
      qa: "pass",
      review: "pass",
      scope: "pass",
      runner
    });

    expect(result).toMatchObject({
      merged: true,
      mergeCommitOid: "abc123",
      summary: "Merged PR #104."
    });
    expect(result.mergeAttempts.map((attempt) => attempt.method)).toEqual(["squash", "merge"]);

    const progress = JSON.parse(
      fs.readFileSync(path.join(workdir, ".agents", "state", "progress.json"), "utf8")
    );
    expect(progress.completed).toContain("T1500-6");
    expect(progress.stats.ci_polls).toBe(1);

    const learnings = fs.readFileSync(path.join(workdir, ".agents", "state", "learnings.jsonl"), "utf8");
    expect(learnings).toContain("github-ci-skipped-nonrequired-checks");
    expect(learnings).toContain("github-squash-merge-disabled");
    expect(learnings).toContain("github-merge-local-worktree-post-merge-error");

    const timeline = fs.readFileSync(path.join(workdir, ".agents", "state", "timeline.jsonl"), "utf8");
    expect(timeline).toContain('"stage":"ship"');
    expect(timeline).toContain('"status":"pass"');
  });

  it("blocks auto-merge when review file contains P1 findings", () => {
    const runner = new FakeRunner([
      ghView({
        state: "OPEN",
        checks: [{ name: "verify", workflowName: "CI", status: "COMPLETED", conclusion: "SUCCESS" }]
      }),
      command({ stdout: "" })
    ]);

    const result = shipPullRequest({
      projectRoot: workdir,
      prNumber: 104,
      autoMerge: true,
      qa: "pass",
      scope: "pass",
      expectedReviewers: ["security"],
      reviews: [
        {
          reviewer: "security",
          status: "pass",
          findings: [{ priority: 1, title: "Auth bypass" }]
        }
      ],
      runner
    });

    expect(result.merged).toBe(false);
    expect(result.gate).toMatchObject({
      allowed: false,
      reasons: ["AI review found P0/P1 issues"]
    });
    expect(result.mergeAttempts).toEqual([]);
  });
});

function ghView(input: {
  state: "OPEN" | "MERGED" | "CLOSED";
  mergeCommitOid?: string | null;
  checks?: Array<Record<string, unknown>>;
}): CommandResult {
  return command({
    stdout: `${JSON.stringify({
      number: 104,
      state: input.state,
      url: "https://github.com/rymetry/verdict/pull/104",
      mergeCommit: input.mergeCommitOid ? { oid: input.mergeCommitOid } : null,
      statusCheckRollup: input.checks ?? []
    })}\n`
  });
}

function command(partial: Partial<CommandResult>): CommandResult {
  return {
    exitCode: partial.exitCode ?? 0,
    stdout: partial.stdout ?? "",
    stderr: partial.stderr ?? ""
  };
}

class FakeRunner implements CommandRunner {
  readonly calls: string[][] = [];

  constructor(private readonly results: CommandResult[]) {}

  run(commandName: string, args: readonly string[]): CommandResult {
    this.calls.push([commandName, ...args]);
    const result = this.results.shift();
    if (!result) {
      throw new Error(`Unexpected command: ${commandName} ${args.join(" ")}`);
    }
    return result;
  }
}
