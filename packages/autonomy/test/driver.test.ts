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
    const stateDir = path.join(workdir, ".agents", "state");
    expect(fs.existsSync(path.join(stateDir, "progress.json"))).toBe(true);
    expect(fs.readFileSync(path.join(stateDir, "timeline.jsonl"), "utf8").trim().split("\n")).toHaveLength(7);
    expect(fs.readFileSync(path.join(stateDir, "learnings.jsonl"), "utf8")).toContain(
      "autonomy-lifecycle-v1"
    );
    expect(fs.existsSync(path.join(stateDir, "lock"))).toBe(false);
  });

  it("fails closed when full execution is requested before adapters exist", () => {
    expect(() => drive({ projectRoot: workdir })).toThrow(/Full execution is not enabled/);

    const stateDir = path.join(workdir, ".agents", "state");
    const progress = JSON.parse(fs.readFileSync(path.join(stateDir, "progress.json"), "utf8"));
    expect(progress.escalated[0]).toMatchObject({
      id: "full-execution-not-enabled",
      class: "UNCLASSIFIED"
    });
  });
});
