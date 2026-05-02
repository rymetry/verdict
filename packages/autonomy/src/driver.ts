import { loadConfig, resolveWorkflow } from "./config.js";
import { acquireLock } from "./lock.js";
import { appendLearning, appendTimeline, ensureProgress, writeProgress } from "./state.js";
import type { StageName } from "./types.js";

export interface DriveOptions {
  projectRoot: string;
  dryRun?: boolean;
}

export interface DriveResult {
  dryRun: boolean;
  stages: StageName[];
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
          message: `Resolved ${stage} stage without executing side effects.`
        },
        evidence: [".agents/autonomy.config.json"]
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
      progressPath: ".agents/state/progress.json",
      summary: `Resolved ${stages.length} autonomy stages.`
    };
  } finally {
    lock.release();
  }
}
