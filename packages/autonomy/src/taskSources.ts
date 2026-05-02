import * as fs from "node:fs";
import * as path from "node:path";
import type { AutonomyConfig, ProgressState, TaskBrief, TaskSelection } from "./types.js";

const VERDICT_PHASE_15_WAVES = [
  ["T1500-1", "T1500-2", "T1500-8"],
  ["T1500-3", "T1500-4", "T1500-5", "T1500-6"],
  ["T1500-7", "T1500-9"],
  ["T1500-10"]
];

interface PlanTaskRow {
  id: string;
  title: string;
  location: string;
}

export function pickTask(
  projectRoot: string,
  config: AutonomyConfig,
  progress: ProgressState
): TaskSelection {
  if (config.adapters.taskSource !== "verdict-plan-v3") {
    return {
      task: null,
      warnings: [`Task source ${config.adapters.taskSource} is not implemented yet.`],
      evidence: [".agents/autonomy.config.json"]
    };
  }
  return pickVerdictPlanV3Task(projectRoot, config, progress);
}

export function pickVerdictPlanV3Task(
  projectRoot: string,
  config: AutonomyConfig,
  progress: ProgressState
): TaskSelection {
  const planPath = path.join(projectRoot, "docs", "product", "PLAN.v3.md");
  if (!fs.existsSync(planPath)) {
    return {
      task: null,
      warnings: ["docs/product/PLAN.v3.md was not found."],
      evidence: [".agents/state/progress.json"]
    };
  }

  if (progress.active !== null) {
    return {
      task: null,
      warnings: [`Active task ${progress.active.id} is already in progress.`],
      evidence: [".agents/state/progress.json", "docs/product/PLAN.v3.md"],
      blockedReason: "active-task-in-progress"
    };
  }

  const rows = parsePlanV3Rows(fs.readFileSync(planPath, "utf8"));
  const completed = new Set(progress.completed);
  for (const wave of VERDICT_PHASE_15_WAVES) {
    const incomplete = wave.filter((id) => !completed.has(id));
    if (incomplete.length === 0) {
      continue;
    }
    const next = rows.get(incomplete[0]);
    if (!next) {
      return {
        task: null,
        warnings: [`Task ${incomplete[0]} is in the active wave but missing from PLAN.v3.`],
        evidence: [".agents/state/progress.json", "docs/product/PLAN.v3.md"],
        blockedReason: "task-missing-from-plan"
      };
    }
    const task = {
      id: next.id,
      title: next.title,
      deliverable: `${next.title} | ${next.location}`,
      expectedScope: inferExpectedScope(next.location),
      highRisk: isHighRisk(next, config)
    };
    return {
      task,
      warnings: [],
      evidence: [".agents/state/progress.json", "docs/product/PLAN.v3.md"]
    };
  }
  return {
    task: null,
    warnings: [],
    evidence: [".agents/state/progress.json", "docs/product/PLAN.v3.md"]
  };
}

export function parsePlanV3Rows(markdown: string): Map<string, PlanTaskRow> {
  const rows = new Map<string, PlanTaskRow>();
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\|\s*(T\d{4}-\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (!match) {
      continue;
    }
    rows.set(match[1], {
      id: match[1],
      title: stripMarkdown(match[2].trim()),
      location: stripMarkdown(match[3].trim())
    });
  }
  return rows;
}

function stripMarkdown(value: string): string {
  return value.replace(/`([^`]+)`/g, "$1");
}

function inferExpectedScope(location: string): string[] {
  if (location.includes("rfcs/")) {
    return ["docs/product/rfcs"];
  }
  const paths = [...location.matchAll(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)/g)].map((match) =>
    match[1].replace(/\/$/, "")
  );
  if (paths.length > 0) {
    return paths;
  }
  return [];
}

function isHighRisk(row: PlanTaskRow, config: AutonomyConfig): boolean {
  const haystack = `${row.id} ${row.title} ${row.location}`.toLowerCase();
  for (const pattern of config.safety?.highRiskPatterns ?? []) {
    if (pattern.trim() && haystack.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  return false;
}
