import { loadConfig, resolveWorkflow } from "./config.js";
import { acquireLock } from "./lock.js";
import { appendLearning, appendTimeline, ensureProgress, writeProgress } from "./state.js";
import { pickTask } from "./taskSources.js";
import type { StageName, TaskBrief } from "./types.js";

export interface DriveOptions {
  projectRoot: string;
  dryRun?: boolean;
}

export interface DriveResult {
  dryRun: boolean;
  stages: StageName[];
  task: TaskBrief | null;
  warnings: string[];
  blockedReason?: string;
  progressPath: string;
  summary: string;
}

export function drive(options: DriveOptions): DriveResult {
  const config = loadConfig(options.projectRoot);
  const stages = resolveWorkflow(config);
  const lock = acquireLock(options.projectRoot);
  try {
    const progress = ensureProgress(options.projectRoot);
    progress.last_iter_at = new Date().toISOString();
    progress.stats.iterations += 1;
    writeProgress(options.projectRoot, progress);
    const selection = applyHighRiskGate(pickTask(options.projectRoot, config, progress));

    if (selection.blockedReason === "high-risk-task" && !options.dryRun) {
      const failure = appendTimeline(options.projectRoot, {
        stage: "plan",
        status: "fail",
        input: { adapters: config.adapters },
        output: {
          message: "Selected task is high risk and requires explicit human approval.",
          task: selection.task,
          taskWarnings: selection.warnings,
          blockedReason: selection.blockedReason
        },
        failureClass: "UNCLASSIFIED",
        evidence: [".agents/autonomy.config.json", ...selection.evidence]
      });
      progress.escalated.push({
        id: selection.task?.id ?? "high-risk-task",
        at: failure.at,
        class: "UNCLASSIFIED",
        reason: "Selected task is high risk and requires explicit human approval."
      });
      writeProgress(options.projectRoot, progress);
      throw new Error("Selected task is high risk and requires explicit human approval.");
    }

    if (!options.dryRun) {
      const failure = appendTimeline(options.projectRoot, {
        stage: "build",
        status: "fail",
        input: { adapters: config.adapters },
        output: {
          message:
            "Full execution is not enabled in the v1 foundation driver. Run with --dry-run until adapters are implemented."
        },
        failureClass: "UNCLASSIFIED"
      });
      progress.escalated.push({
        id: "full-execution-not-enabled",
        at: failure.at,
        class: "UNCLASSIFIED",
        reason: "Full execution is not enabled in the v1 foundation driver."
      });
      writeProgress(options.projectRoot, progress);
      throw new Error("Full execution is not enabled. Use --dry-run until adapters are implemented.");
    }

    for (const stage of stages) {
      appendTimeline(options.projectRoot, {
        stage,
        status: "dry-run",
        input: { adapters: config.adapters },
        output: {
          message: `Resolved ${stage} stage without executing side effects.`,
          task: selection.task,
          taskWarnings: selection.warnings,
          blockedReason: selection.blockedReason
        },
        evidence: [".agents/autonomy.config.json", ...selection.evidence]
      });
    }

    appendLearning(options.projectRoot, {
      key: "autonomy-lifecycle-v1",
      type: "decision",
      insight:
        "Generic autonomy v1 runs Think -> Plan -> Build -> QA -> Review -> Ship -> optional Deploy/Monitor -> Learn.",
      source: "driver"
    });

    return {
      dryRun: Boolean(options.dryRun),
      stages,
      task: selection.task,
      warnings: selection.warnings,
      blockedReason: selection.blockedReason,
      progressPath: ".agents/state/progress.json",
      summary:
        selection.task === null
          ? `Resolved ${stages.length} autonomy stages.`
          : `Resolved ${stages.length} autonomy stages for ${selection.task.id}.`
    };
  } finally {
    lock.release();
  }
}

function applyHighRiskGate<T extends { task: TaskBrief | null; warnings: string[]; blockedReason?: string }>(
  selection: T
): T {
  if (!selection.task?.highRisk || selection.blockedReason) {
    return selection;
  }
  return {
    ...selection,
    warnings: [...selection.warnings, `Task ${selection.task.id} is high risk and requires approval.`],
    blockedReason: "high-risk-task"
  };
}
