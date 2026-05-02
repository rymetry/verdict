import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock } from "../src/lock.js";
import {
  appendLearning,
  appendTimeline,
  createInitialProgress,
  ensureProgress,
  learningsPath,
  seedCompletedTasks,
  timelinePath
} from "../src/state.js";

let workdir: string;

beforeEach(() => {
  workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-state-")));
});

afterEach(() => {
  fs.rmSync(workdir, { recursive: true, force: true });
});

describe("progress state", () => {
  it("initializes progress with a real timestamp", () => {
    const now = new Date("2026-05-02T00:00:00.000Z");
    const progress = ensureProgress(workdir, now);

    expect(progress).toEqual(createInitialProgress(now));
    expect(fs.readFileSync(path.join(workdir, ".agents/state/progress.json"), "utf8")).toContain(
      "2026-05-02T00:00:00.000Z"
    );
  });

  it("seeds completed tasks with de-duplication and timeline evidence", () => {
    const now = new Date("2026-05-02T00:00:00.000Z");
    const first = seedCompletedTasks({
      projectRoot: workdir,
      taskIds: ["TASK-1", "TASK-2", "TASK-1"],
      now
    });
    const second = seedCompletedTasks({
      projectRoot: workdir,
      taskIds: ["TASK-2", "TASK-3"],
      now
    });

    expect(first).toMatchObject({
      added: ["TASK-1", "TASK-2"],
      ignored: [],
      completed: ["TASK-1", "TASK-2"]
    });
    expect(second).toMatchObject({
      added: ["TASK-3"],
      ignored: ["TASK-2"],
      completed: ["TASK-1", "TASK-2", "TASK-3"]
    });
    expect(fs.readFileSync(timelinePath(workdir), "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("rejects unknown task ids when a known baseline is provided", () => {
    expect(() =>
      seedCompletedTasks({
        projectRoot: workdir,
        taskIds: ["TASK-3"],
        knownTaskIds: ["TASK-1", "TASK-2"],
        now: new Date("2026-05-02T00:00:00.000Z")
      })
    ).toThrow(/Unknown task id\(s\): TASK-3/);
  });

  it("refuses to seed an active task as completed", () => {
    const progress = createInitialProgress(new Date("2026-05-02T00:00:00.000Z"));
    progress.active = {
      id: "TASK-1",
      pr_number: null,
      branch: null,
      stage: "build",
      started_at: "2026-05-02T00:00:00.000Z",
      last_attempt_at: "2026-05-02T00:00:00.000Z"
    };
    fs.mkdirSync(path.join(workdir, ".agents/state"), { recursive: true });
    fs.writeFileSync(
      path.join(workdir, ".agents/state/progress.json"),
      `${JSON.stringify(progress, null, 2)}\n`
    );

    expect(() =>
      seedCompletedTasks({
        projectRoot: workdir,
        taskIds: ["TASK-1"],
        now: new Date("2026-05-02T00:00:00.000Z")
      })
    ).toThrow(/Cannot mark active task TASK-1 as completed/);
  });

  it("refuses to seed a legacy tid active task as completed", () => {
    const progress = createInitialProgress(new Date("2026-05-02T00:00:00.000Z"));
    fs.mkdirSync(path.join(workdir, ".agents/state"), { recursive: true });
    fs.writeFileSync(
      path.join(workdir, ".agents/state/progress.json"),
      `${JSON.stringify({ ...progress, active: { tid: "TASK-1" } }, null, 2)}\n`
    );

    expect(() =>
      seedCompletedTasks({
        projectRoot: workdir,
        taskIds: ["TASK-1"],
        now: new Date("2026-05-02T00:00:00.000Z")
      })
    ).toThrow(/Cannot mark active task TASK-1 as completed/);
  });

  it("does not seed while another autonomy operation holds the lock", () => {
    const lock = acquireLock(workdir);
    try {
      expect(() =>
        seedCompletedTasks({
          projectRoot: workdir,
          taskIds: ["TASK-1"],
          now: new Date("2026-05-02T00:00:00.000Z")
        })
      ).toThrow(/already locked/);
    } finally {
      lock.release();
    }
  });
});

describe("timeline and learnings", () => {
  it("appends timeline entries and de-duplicates learning keys", () => {
    appendTimeline(workdir, { stage: "think", status: "dry-run" });
    appendLearning(workdir, {
      key: "same-key",
      type: "decision",
      insight: "Keep learn as a first-class stage.",
      source: "driver"
    });
    appendLearning(workdir, {
      key: "same-key",
      type: "decision",
      insight: "Duplicate should not be appended.",
      source: "driver"
    });

    expect(fs.readFileSync(timelinePath(workdir), "utf8").trim().split("\n")).toHaveLength(1);
    expect(fs.readFileSync(learningsPath(workdir), "utf8").trim().split("\n")).toHaveLength(1);
  });
});

describe("lock", () => {
  it("prevents concurrent autonomy loops", () => {
    const lock = acquireLock(workdir);
    try {
      expect(() => acquireLock(workdir)).toThrow(/already locked/);
    } finally {
      lock.release();
    }
    expect(() => acquireLock(workdir).release()).not.toThrow();
  });
});
