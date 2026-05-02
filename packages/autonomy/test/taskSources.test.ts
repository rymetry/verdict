import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  knownTaskIds,
  parseMarkdownRoadmap,
  pickMarkdownRoadmapTask,
  pickTask
} from "../src/taskSources.js";
import { createInitialProgress } from "../src/state.js";
import type { AutonomyConfig, ProgressState } from "../src/types.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-tasksource-")));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("parseMarkdownRoadmap", () => {
  it("extracts unchecked roadmap tasks with explicit or fallback ids", () => {
    expect(
      parseMarkdownRoadmap(
        [
          "- [ ] ROADMAP-1: Add lifecycle CLI",
          "- [x] ROADMAP-2: Already done",
          "- [ ] [ROADMAP-3] Add docs",
          "- [ ] Untitled work item"
        ].join("\n")
      )
    ).toMatchObject([
      { id: "ROADMAP-1", title: "Add lifecycle CLI", line: 1 },
      { id: "ROADMAP-3", title: "Add docs", line: 3 },
      { id: "ROADMAP-4", title: "Untitled work item", line: 4 }
    ]);
  });
});

describe("pickMarkdownRoadmapTask", () => {
  it("picks the first unchecked markdown task not in progress.completed", () => {
    writeRoadmap();

    expect(pickMarkdownRoadmapTask(workdir, markdownConfig(), progress(["ROADMAP-1"]))).toMatchObject({
      task: {
        id: "ROADMAP-2",
        title: "Add docs",
        deliverable: "Add docs | ROADMAP.md:4",
        expectedScope: ["docs/README.md"],
        highRisk: false
      },
      warnings: []
    });
  });

  it("blocks when a task is already active", () => {
    writeRoadmap();

    expect(
      pickMarkdownRoadmapTask(
        workdir,
        markdownConfig(),
        progress([], {
          id: "ROADMAP-1",
          pr_number: null,
          branch: "chore/roadmap-1",
          stage: "build",
          started_at: "2026-05-02T00:00:00.000Z",
          last_attempt_at: "2026-05-02T00:00:00.000Z"
        })
      )
    ).toMatchObject({
      task: null,
      blockedReason: "active-task-in-progress"
    });
  });

  it("returns a blocked selection when no roadmap tasks exist", () => {
    expect(pickTask(workdir, markdownConfig(), progress())).toMatchObject({
      task: null,
      blockedReason: "no-roadmap-tasks",
      warnings: [expect.stringContaining("No markdown roadmap tasks found")]
    });
  });

  it("rejects roadmap paths outside the project root", () => {
    expect(
      pickTask(
        workdir,
        {
          ...markdownConfig(),
          taskSources: { markdownRoadmap: { paths: ["../ROADMAP.md"] } }
        },
        progress()
      )
    ).toMatchObject({
      task: null,
      blockedReason: "roadmap-path-invalid"
    });
  });

  it("rejects roadmap symlinks outside the project root", () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-outside-")));
    try {
      fs.writeFileSync(path.join(outside, "ROADMAP.md"), "- [ ] ROADMAP-1: Outside\n");
      fs.symlinkSync(path.join(outside, "ROADMAP.md"), path.join(workdir, "ROADMAP.md"));

      expect(pickTask(workdir, markdownConfig(), progress())).toMatchObject({
        task: null,
        blockedReason: "roadmap-path-invalid"
      });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("exposes known task ids for progress seeding validation", () => {
    writeRoadmap();

    expect(knownTaskIds(workdir, markdownConfig())).toEqual(["ROADMAP-1", "ROADMAP-2"]);
  });

  it("fails closed for seed validation when no markdown roadmap exists yet", () => {
    expect(knownTaskIds(workdir, markdownConfig())).toEqual([]);
  });
});

describe("pickCustomCommandTask", () => {
  it("uses a command adapter to select a task", () => {
    writeCustomTaskSource();

    expect(pickTask(workdir, customCommandConfig(), progress(["CMD-1"]))).toMatchObject({
      task: {
        id: "CMD-2",
        title: "Second command task",
        deliverable: "Second command task | command",
        expectedScope: ["docs/"]
      },
      evidence: ["custom-task-source.mjs"]
    });
  });

  it("blocks when the command is not configured", () => {
    expect(
      pickTask(
        workdir,
        { ...customCommandConfig(), taskSources: { customCommand: { command: [] } } },
        progress()
      )
    ).toMatchObject({
      task: null,
      blockedReason: "task-source-command-missing"
    });
  });

  it("blocks when the command output is invalid", () => {
    const script = path.join(workdir, "invalid-task-source.mjs");
    fs.writeFileSync(script, "console.log('not json');\n");

    expect(
      pickTask(
        workdir,
        {
          ...customCommandConfig(),
          taskSources: { customCommand: { command: [process.execPath, script] } }
        },
        progress()
      )
    ).toMatchObject({
      task: null,
      blockedReason: "task-source-command-invalid"
    });
  });
});

function writeRoadmap(): void {
  fs.writeFileSync(
    path.join(workdir, "ROADMAP.md"),
    [
      "# Roadmap",
      "",
      "- [ ] ROADMAP-1: Add lifecycle CLI",
      "- [ ] ROADMAP-2: Add docs `docs/README.md`"
    ].join("\n")
  );
}

function markdownConfig(): AutonomyConfig {
  return {
    version: 1,
    adapters: {
      taskSource: "markdown-roadmap",
      executor: "codex",
      verifier: "custom-command",
      reviewer: "codex-review",
      publisher: "github-pr"
    },
    taskSources: {
      markdownRoadmap: {
        paths: ["ROADMAP.md"]
      }
    },
    safety: {
      highRiskPatterns: ["auth", "permission", "billing", "deploy"]
    }
  };
}

function writeCustomTaskSource(): void {
  fs.writeFileSync(
    path.join(workdir, "custom-task-source.mjs"),
    [
      "const progress = JSON.parse(process.env.AGENT_AUTONOMY_PROGRESS ?? '{}');",
      "const completed = new Set(progress.completed ?? []);",
      "const tasks = [",
      "  { id: 'CMD-1', title: 'First command task', deliverable: 'First command task | command', expectedScope: [] },",
      "  { id: 'CMD-2', title: 'Second command task', deliverable: 'Second command task | command', expectedScope: ['docs/'] }",
      "];",
      "const task = tasks.find((candidate) => !completed.has(candidate.id)) ?? null;",
      "console.log(JSON.stringify({ task, warnings: [], evidence: ['custom-task-source.mjs'] }));"
    ].join("\n")
  );
}

function customCommandConfig(): AutonomyConfig {
  return {
    version: 1,
    adapters: {
      taskSource: "custom-command",
      executor: "codex",
      verifier: "custom-command",
      reviewer: "codex-review",
      publisher: "github-pr"
    },
    taskSources: {
      customCommand: {
        command: [process.execPath, path.join(workdir, "custom-task-source.mjs")]
      }
    },
    safety: {
      highRiskPatterns: ["auth", "permission", "billing", "deploy"]
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
