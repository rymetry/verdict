import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePlanV3Rows, pickVerdictPlanV3Task } from "../src/taskSources.js";
import { createInitialProgress } from "../src/state.js";
import type { AutonomyConfig, ProgressState } from "../src/types.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-tasksource-")));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("parsePlanV3Rows", () => {
  it("extracts task rows from the PLAN.v3 table", () => {
    const rows = parsePlanV3Rows(
      "| T1500-1 | `.workbench/` directory 仕様の確定 | `rfcs/0001-workbench-directory.md` |\n"
    );

    expect(rows.get("T1500-1")).toEqual({
      id: "T1500-1",
      title: ".workbench/ directory 仕様の確定",
      location: "rfcs/0001-workbench-directory.md"
    });
  });
});

describe("pickVerdictPlanV3Task", () => {
  it("picks the lowest incomplete task in the active wave", () => {
    writePlan();

    expect(pickVerdictPlanV3Task(workdir, config(), progress())).toMatchObject({
      task: {
        id: "T1500-1",
        title: ".workbench/ directory 仕様の確定",
        expectedScope: ["docs/product/rfcs"],
        highRisk: false
      },
      warnings: []
    });
  });

  it("advances to the next wave only after the current wave is complete", () => {
    writePlan();

    expect(
      pickVerdictPlanV3Task(workdir, config(), progress(["T1500-1", "T1500-2", "T1500-8"]))
    ).toMatchObject({
      task: {
        id: "T1500-3",
        expectedScope: ["apps/agent/src/exploration"]
      }
    });
  });

  it("blocks when progress already has an active task", () => {
    writePlan();

    expect(
      pickVerdictPlanV3Task(
        workdir,
        config(),
        progress([], {
          id: "T1500-8",
          title: "Code Generation 強化",
          pr_number: 96,
          branch: "chore/autonomy-tasksource-dogfood",
          stage: "review",
          started_at: "2026-05-02T00:00:00.000Z",
          last_attempt_at: "2026-05-02T00:00:00.000Z"
        })
      )
    ).toMatchObject({
      task: null,
      blockedReason: "active-task-in-progress",
      warnings: ["Active task T1500-8 is already in progress."]
    });
  });

  it("marks tasks high-risk when configured patterns match the row", () => {
    writePlan();

    expect(
      pickVerdictPlanV3Task(
        workdir,
        config({ highRiskPatterns: ["stagehand"] }),
        progress(["T1500-1", "T1500-2", "T1500-8"])
      )
    ).toMatchObject({
      task: {
        id: "T1500-3",
        highRisk: true
      }
    });
  });
});

function writePlan(): void {
  fs.mkdirSync(path.join(workdir, "docs/product"), { recursive: true });
  fs.writeFileSync(
    path.join(workdir, "docs/product/PLAN.v3.md"),
    [
      "| # | 成果物 | 所在 |",
      "|---|---|---|",
      "| T1500-1 | `.workbench/` directory 仕様の確定 | `rfcs/0001-workbench-directory.md` |",
      "| T1500-2 | AGENTS.md / skills/ / rules/ / hooks/ / intents/ / prompts/ の loader 実装 | `apps/agent/src/workbench/` (新規) |",
      "| T1500-3 | Exploration Engine (Stagehand / Browser Use adapter) | `apps/agent/src/exploration/` (新規) |",
      "| T1500-8 | Code Generation 強化 (rule/skill/hook context 注入) | 既存 `apps/agent/src/ai/cliAdapter.ts` の拡張 |"
    ].join("\n")
  );
}

function config(options: { highRiskPatterns?: string[] } = {}): AutonomyConfig {
  return {
    version: 1,
    adapters: {
      taskSource: "verdict-plan-v3",
      executor: "codex",
      verifier: "verdict-verify-completion",
      reviewer: "codex-review",
      publisher: "github-pr"
    },
    safety: {
      highRiskPatterns: options.highRiskPatterns ?? ["auth", "permission", "billing", "deploy"]
    }
  };
}

function progress(
  completed: string[] = [],
  active: ProgressState["active"] = null
): ProgressState {
  return {
    ...createInitialProgress(new Date("2026-05-02T00:00:00.000Z")),
    active,
    completed
  };
}
