import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { drive } from "../src/driver.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-drive-")));
  fs.mkdirSync(path.join(workdir, ".agents"), { recursive: true });
  fs.writeFileSync(
    path.join(workdir, ".agents", "autonomy.config.json"),
    JSON.stringify(
      {
        version: 1,
        workflow: {
          stages: ["think", "plan", "build", "qa-only", "review", "ship", "learn"]
        },
        adapters: {
          taskSource: "markdown-roadmap",
          executor: "codex",
          verifier: "custom-command",
          reviewer: "codex-review",
          publisher: "github-pr"
        }
      },
      null,
      2
    )
  );
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("drive", () => {
  it("runs a dry-run lifecycle and records progress, timeline, and learnings", () => {
    const result = drive({ projectRoot: workdir, dryRun: true });

    expect(result.stages).toEqual(["think", "plan", "build", "qa-only", "review", "ship", "learn"]);
    expect(result.task).toBeNull();
    const stateDir = path.join(workdir, ".agents", "state");
    expect(fs.existsSync(path.join(stateDir, "progress.json"))).toBe(true);
    expect(fs.readFileSync(path.join(stateDir, "timeline.jsonl"), "utf8").trim().split("\n")).toHaveLength(7);
    expect(fs.readFileSync(path.join(stateDir, "learnings.jsonl"), "utf8")).toContain(
      "autonomy-lifecycle-v1"
    );
    expect(fs.existsSync(path.join(stateDir, "lock"))).toBe(false);
  });

  it("stops safely when full execution has no selected task", () => {
    const result = drive({ projectRoot: workdir });

    const stateDir = path.join(workdir, ".agents", "state");
    const progress = JSON.parse(fs.readFileSync(path.join(stateDir, "progress.json"), "utf8"));
    expect(result).toMatchObject({
      dryRun: false,
      task: null,
      summary: "no-roadmap-tasks"
    });
    expect(progress.escalated).toEqual([]);
    expect(fs.readFileSync(path.join(stateDir, "timeline.jsonl"), "utf8")).toContain('"status":"skipped"');
  });

  it("executes a selected task through the configured command runner", () => {
    fs.writeFileSync(path.join(workdir, "ROADMAP.md"), "- [ ] ROADMAP-1: Add smoke metadata\n");
    fs.writeFileSync(
      path.join(workdir, ".agents", "autonomy.config.json"),
      JSON.stringify(
        {
          version: 1,
          workflow: {
            stages: ["think", "plan", "build", "qa-only", "review", "ship", "learn"]
          },
          adapters: {
            taskSource: "markdown-roadmap",
            executor: "custom-command",
            verifier: "custom-command",
            reviewer: "codex-review",
            publisher: "github-pr"
          },
          executors: {
            customCommand: {
              command: [process.execPath, "executor.mjs", "{promptPath}", "{taskId}"]
            }
          }
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(workdir, "executor.mjs"),
      "console.log(`executed ${process.argv[3]} from ${process.argv[2]}`);\n"
    );

    const result = drive({ projectRoot: workdir });

    const stateDir = path.join(workdir, ".agents", "state");
    const progress = JSON.parse(fs.readFileSync(path.join(stateDir, "progress.json"), "utf8"));
    const timeline = fs.readFileSync(path.join(stateDir, "timeline.jsonl"), "utf8");
    expect(result).toMatchObject({
      dryRun: false,
      task: { id: "ROADMAP-1" },
      blockedReason: "waiting-for-pr",
      summary:
        "executed ROADMAP-1 from .agents/state/executor-prompt-Uk9BRE1BUC0x.md Waiting for PR publication, QA, review, and ship gates."
    });
    expect(progress.stats.executor_calls).toBe(1);
    expect(progress.active).toMatchObject({ id: "ROADMAP-1", stage: "build" });
    expect(timeline).toContain('"stage":"build"');
    expect(timeline).toContain('"status":"pass"');
    expect(timeline).toContain('"stage":"review"');
    expect(timeline).toContain('"status":"pending"');
    expect(fs.existsSync(path.join(stateDir, "executor-prompt-Uk9BRE1BUC0x.md"))).toBe(true);
  });

  it("records failure classification and retry state when execution fails", () => {
    fs.writeFileSync(path.join(workdir, "ROADMAP.md"), "- [ ] ROADMAP-1: Add smoke metadata\n");
    fs.writeFileSync(
      path.join(workdir, ".agents", "autonomy.config.json"),
      JSON.stringify(
        {
          version: 1,
          workflow: {
            stages: ["think", "plan", "build", "qa-only", "review", "ship", "learn"]
          },
          adapters: {
            taskSource: "markdown-roadmap",
            executor: "custom-command",
            verifier: "custom-command",
            reviewer: "codex-review",
            publisher: "github-pr"
          },
          executors: {
            customCommand: {
              command: [process.execPath, "executor.mjs"]
            }
          }
        },
        null,
        2
      )
    );
    fs.writeFileSync(
      path.join(workdir, "executor.mjs"),
      "console.error('error connecting to api.github.com'); process.exit(1);\n"
    );

    const result = drive({ projectRoot: workdir });

    const stateDir = path.join(workdir, ".agents", "state");
    const progress = JSON.parse(fs.readFileSync(path.join(stateDir, "progress.json"), "utf8"));
    const timeline = fs.readFileSync(path.join(stateDir, "timeline.jsonl"), "utf8");
    expect(result).toMatchObject({
      dryRun: false,
      task: { id: "ROADMAP-1" },
      blockedReason: "executor-failed"
    });
    expect(progress.failure_counts["ROADMAP-1"]).toBe(1);
    expect(progress.escalated[0]).toMatchObject({
      id: "ROADMAP-1",
      class: "TOOL_NETWORK_FAILURE"
    });
    expect(timeline).toContain('"failureClass":"TOOL_NETWORK_FAILURE"');
  });

  it("escalates through the retry limit after repeated executor failures", () => {
    fs.writeFileSync(path.join(workdir, "ROADMAP.md"), "- [ ] ROADMAP-1: Add smoke metadata\n");
    fs.writeFileSync(
      path.join(workdir, ".agents", "autonomy.config.json"),
      JSON.stringify(
        {
          version: 1,
          workflow: {
            stages: ["think", "plan", "build", "qa-only", "review", "ship", "learn"]
          },
          adapters: {
            taskSource: "markdown-roadmap",
            executor: "custom-command",
            verifier: "custom-command",
            reviewer: "codex-review",
            publisher: "github-pr"
          },
          executors: {
            customCommand: {
              command: [process.execPath, "executor.mjs"]
            }
          },
          safety: {
            maxFailuresPerTask: 1
          }
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(workdir, "executor.mjs"), "console.error('type error'); process.exit(1);\n");

    const result = drive({ projectRoot: workdir });

    expect(result).toMatchObject({
      blockedReason: "max-failures-exceeded",
      summary: "Task ROADMAP-1 reached 1 failures. Escalating through escape-loop."
    });
  });

  it("retries the active markdown task until the retry limit is reached", () => {
    fs.writeFileSync(path.join(workdir, "ROADMAP.md"), "- [ ] ROADMAP-1: Add smoke metadata\n");
    fs.writeFileSync(
      path.join(workdir, ".agents", "autonomy.config.json"),
      JSON.stringify(
        {
          version: 1,
          workflow: {
            stages: ["think", "plan", "build", "qa-only", "review", "ship", "learn"]
          },
          adapters: {
            taskSource: "markdown-roadmap",
            executor: "custom-command",
            verifier: "custom-command",
            reviewer: "codex-review",
            publisher: "github-pr"
          },
          taskSources: {
            markdownRoadmap: {
              paths: ["ROADMAP.md"]
            }
          },
          executors: {
            customCommand: {
              command: [process.execPath, "executor.mjs", "{taskId}"]
            }
          },
          safety: {
            maxFailuresPerTask: 3
          }
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(workdir, "executor.mjs"), "console.error(`type error ${process.argv[2]}`); process.exit(1);\n");

    const first = drive({ projectRoot: workdir });
    const second = drive({ projectRoot: workdir });

    const progress = JSON.parse(
      fs.readFileSync(path.join(workdir, ".agents", "state", "progress.json"), "utf8")
    );
    expect(first).toMatchObject({ task: { id: "ROADMAP-1" }, blockedReason: "executor-failed" });
    expect(second).toMatchObject({ task: { id: "ROADMAP-1" }, blockedReason: "executor-failed" });
    expect(second.warnings).toContain("Retrying active task ROADMAP-1.");
    expect(progress.failure_counts["ROADMAP-1"]).toBe(2);
  });

  it("marks high-risk task selections as blocked", () => {
    fs.writeFileSync(path.join(workdir, "ROADMAP.md"), "- [ ] ROADMAP-1: Update deploy flow\n");

    const result = drive({ projectRoot: workdir, dryRun: true });

    expect(result.task).toMatchObject({ id: "ROADMAP-1", highRisk: true });
    expect(result.blockedReason).toBe("high-risk-task");
    expect(result.warnings).toContain("Task ROADMAP-1 is high risk and requires approval.");
  });
});
