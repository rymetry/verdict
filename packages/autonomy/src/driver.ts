import { loadConfig, resolveWorkflow } from "./config.js";
import { executeTask } from "./executor.js";
import { SpawnCommandRunner } from "./githubShip.js";
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

    if (!options.dryRun && selection.task === null) {
      appendTimeline(options.projectRoot, {
        stage: "plan",
        status: "skipped",
        input: { adapters: config.adapters },
        output: {
          message: selection.blockedReason ?? "No task selected.",
          taskWarnings: selection.warnings
        },
        evidence: [".agents/autonomy.config.json", ...selection.evidence]
      });
      return {
        dryRun: false,
        stages,
        task: null,
        warnings: selection.warnings,
        blockedReason: selection.blockedReason,
        progressPath: ".agents/state/progress.json",
        summary: selection.blockedReason ?? "No task selected."
      };
    }

    if (!options.dryRun && selection.task) {
      const maxFailures = config.safety?.maxFailuresPerTask ?? 3;
      if ((progress.failure_counts[selection.task.id] ?? 0) >= maxFailures) {
        appendTimeline(options.projectRoot, {
          stage: "build",
          status: "fail",
          input: { task: selection.task, maxFailures },
          output: {
            message: `Task ${selection.task.id} has reached the retry limit. Escalating through escape-loop.`
          },
          evidence: [".agents/state/progress.json"],
          failureClass: "UNCLASSIFIED"
        });
        return {
          dryRun: false,
          stages,
          task: selection.task,
          warnings: selection.warnings,
          blockedReason: "max-failures-exceeded",
          progressPath: ".agents/state/progress.json",
          summary: `Task ${selection.task.id} has reached the retry limit. Escalating through escape-loop.`
        };
      }
      const execution = executeTask({
        projectRoot: options.projectRoot,
        config,
        task: selection.task,
        runner: new SpawnCommandRunner(options.projectRoot)
      });
      if (execution.status === "fail" || execution.status === "escalated") {
        const nextProgress = ensureProgress(options.projectRoot);
        const failureCount = (nextProgress.failure_counts[selection.task.id] ?? 0) + 1;
        nextProgress.failure_counts[selection.task.id] = failureCount;
        if (execution.failureClass) {
          nextProgress.escalated.push({
            id: selection.task.id,
            at: new Date().toISOString(),
            class: execution.failureClass,
            reason: execution.summary
          });
        }
        writeProgress(options.projectRoot, nextProgress);
        const blockedReason =
          failureCount >= maxFailures ? "max-failures-exceeded" : "executor-failed";
        return {
          dryRun: false,
          stages,
          task: selection.task,
          warnings: selection.warnings,
          blockedReason,
          progressPath: ".agents/state/progress.json",
          summary:
            failureCount >= maxFailures
              ? `Task ${selection.task.id} reached ${failureCount} failures. Escalating through escape-loop.`
              : execution.summary
        };
      }
      appendPostBuildWaitingStages(options.projectRoot, stages, selection.task);
      return {
        dryRun: false,
        stages,
        task: selection.task,
        warnings: selection.warnings,
        blockedReason: execution.prNumber ? "waiting-for-qa-review-ship" : "waiting-for-pr",
        progressPath: ".agents/state/progress.json",
        summary: execution.prNumber
          ? `${execution.summary} PR #${execution.prNumber} is ready for QA, review, and ship gates.`
          : `${execution.summary} Waiting for PR publication, QA, review, and ship gates.`
      };
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

function appendPostBuildWaitingStages(
  projectRoot: string,
  stages: readonly StageName[],
  task: TaskBrief
): void {
  for (const stage of stages) {
    if (stage !== "qa-only" && stage !== "review" && stage !== "ship" && stage !== "learn") {
      continue;
    }
    appendTimeline(projectRoot, {
      stage,
      status: "pending",
      input: { task },
      output: {
        message:
          stage === "learn"
            ? "Learn stage is waiting for ship outcome."
            : `${stage} is waiting for a published PR and explicit gate evidence.`
      },
      evidence: [".agents/state/progress.json"]
    });
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
