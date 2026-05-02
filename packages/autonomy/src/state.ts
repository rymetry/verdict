import * as fs from "node:fs";
import * as path from "node:path";
import type { LearningEntry, ProgressState, TimelineEntry } from "./types.js";

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
