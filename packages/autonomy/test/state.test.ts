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
