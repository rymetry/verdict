import * as fs from "node:fs";
import * as path from "node:path";
import { acquireLock } from "./lock.js";
import type { LearningEntry, ProgressState, TimelineEntry } from "./types.js";

export interface SeedCompletedTasksOptions {
  projectRoot: string;
  taskIds: string[];
  knownTaskIds?: string[];
  allowUnknown?: boolean;
  now?: Date;
}

export interface SeedCompletedTasksResult {
  completed: string[];
  added: string[];
  ignored: string[];
  progressPath: string;
}

export function stateDir(projectRoot: string): string {
  return path.join(projectRoot, ".agents", "state");
}

export function progressPath(projectRoot: string): string {
  return path.join(stateDir(projectRoot), "progress.json");
}

export function timelinePath(projectRoot: string): string {
  return path.join(stateDir(projectRoot), "timeline.jsonl");
}

export function learningsPath(projectRoot: string): string {
  return path.join(stateDir(projectRoot), "learnings.jsonl");
}

export function createInitialProgress(now = new Date()): ProgressState {
  return {
    schema_version: 1,
    started_at: now.toISOString(),
    last_iter_at: null,
    active: null,
    completed: [],
    failure_counts: {},
    escalated: [],
    stats: {
      iterations: 0,
      executor_calls: 0,
      ci_polls: 0,
      deploys: 0
    }
  };
}

export function ensureProgress(projectRoot: string, now = new Date()): ProgressState {
  fs.mkdirSync(stateDir(projectRoot), { recursive: true });
  const target = progressPath(projectRoot);
  if (!fs.existsSync(target)) {
    const initial = createInitialProgress(now);
    fs.writeFileSync(target, `${JSON.stringify(initial, null, 2)}\n`, { mode: 0o600 });
    return initial;
  }
  return JSON.parse(fs.readFileSync(target, "utf8")) as ProgressState;
}

export function writeProgress(projectRoot: string, state: ProgressState): void {
  fs.mkdirSync(stateDir(projectRoot), { recursive: true });
  const target = progressPath(projectRoot);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export function appendTimeline(projectRoot: string, entry: Omit<TimelineEntry, "at">): TimelineEntry {
  fs.mkdirSync(stateDir(projectRoot), { recursive: true });
  const full: TimelineEntry = { at: new Date().toISOString(), ...entry };
  fs.appendFileSync(timelinePath(projectRoot), `${JSON.stringify(full)}\n`, { mode: 0o600 });
  return full;
}

export function appendLearning(projectRoot: string, entry: Omit<LearningEntry, "at">): LearningEntry {
  fs.mkdirSync(stateDir(projectRoot), { recursive: true });
  const target = learningsPath(projectRoot);
  const existingKeys = new Set<string>();
  if (fs.existsSync(target)) {
    for (const line of fs.readFileSync(target, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as LearningEntry;
      existingKeys.add(parsed.key);
    }
  }
  const full: LearningEntry = { at: new Date().toISOString(), ...entry };
  if (!existingKeys.has(full.key)) {
    fs.appendFileSync(target, `${JSON.stringify(full)}\n`, { mode: 0o600 });
  }
  return full;
}

export function seedCompletedTasks(options: SeedCompletedTasksOptions): SeedCompletedTasksResult {
  const lock = acquireLock(options.projectRoot);
  try {
    const taskIds = normalizeTaskIds(options.taskIds, options.knownTaskIds, options.allowUnknown);
    const progress = ensureProgress(options.projectRoot, options.now);
    const activeTaskId = readActiveTaskId(progress);
    if (activeTaskId && taskIds.includes(activeTaskId)) {
      throw new Error(`Cannot mark active task ${activeTaskId} as completed.`);
    }

    const existing = new Set(progress.completed);
    const added: string[] = [];
    const ignored: string[] = [];
    for (const taskId of taskIds) {
      if (existing.has(taskId)) {
        ignored.push(taskId);
        continue;
      }
      existing.add(taskId);
      added.push(taskId);
    }

    progress.completed = [...progress.completed, ...added];
    progress.last_iter_at = (options.now ?? new Date()).toISOString();
    writeProgress(options.projectRoot, progress);
    appendTimeline(options.projectRoot, {
      stage: "learn",
      status: "pass",
      input: { taskIds },
      output: {
        message: "Seeded completed task ids from an operator-provided baseline.",
        added,
        ignored,
        completed: progress.completed
      },
      evidence: [".agents/state/progress.json"]
    });

    return {
      completed: progress.completed,
      added,
      ignored,
      progressPath: ".agents/state/progress.json"
    };
  } finally {
    lock.release();
  }
}

function normalizeTaskIds(
  taskIds: string[],
  knownTaskIds: string[] | undefined,
  allowUnknown = false
): string[] {
  const normalized = taskIds.map((taskId) => taskId.trim()).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error("At least one task id is required.");
  }

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const taskId of normalized) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(taskId)) {
      throw new Error(`Invalid task id: ${taskId}`);
    }
    if (!seen.has(taskId)) {
      seen.add(taskId);
      unique.push(taskId);
    }
  }
  if (knownTaskIds && !allowUnknown) {
    const known = new Set(knownTaskIds);
    const unknown = unique.filter((taskId) => !known.has(taskId));
    if (unknown.length > 0) {
      throw new Error(`Unknown task id(s): ${unknown.join(", ")}`);
    }
  }
  return unique;
}

function readActiveTaskId(progress: ProgressState): string | null {
  if (!progress.active) {
    return null;
  }
  const active = progress.active as ProgressState["active"] & { tid?: unknown };
  if (typeof active.id === "string") {
    return active.id;
  }
  return typeof active.tid === "string" ? active.tid : null;
}
