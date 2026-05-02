import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let workdir: string;

const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.agents/scripts/pick-verdict-plan-v3.mjs"
);

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "verdict-plan-picker-")));
  fs.mkdirSync(path.join(workdir, "docs", "product"), { recursive: true });
  fs.writeFileSync(
    path.join(workdir, "docs", "product", "PLAN.v3.md"),
    [
      "| # | 成果物 | 所在 |",
      "|---|---|---|",
      "| T1500-1 | `.workbench/` directory 仕様の確定 | `rfcs/0001-workbench-directory.md` |",
      "| T1500-2 | Loader 実装 | `apps/agent/src/workbench/` (新規) |"
    ].join("\n")
  );
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("pick-verdict-plan-v3", () => {
  it("reselects an active PLAN.v3 task so the driver can retry it", () => {
    const result = runPicker({
      active: {
        id: "T1500-1"
      },
      completed: []
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      task: {
        id: "T1500-1",
        title: ".workbench/ directory 仕様の確定"
      },
      warnings: ["Retrying active task T1500-1."]
    });
  });

  it("keeps blocking an active task that is missing from PLAN.v3", () => {
    const result = runPicker({
      active: {
        id: "T9999-1"
      },
      completed: []
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      task: null,
      blockedReason: "active-task-in-progress"
    });
  });
});

function runPicker(progress: Record<string, unknown>): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: workdir,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_AUTONOMY_PROGRESS: JSON.stringify(progress)
    },
    shell: false
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
