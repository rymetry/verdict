import { spawnSync } from "node:child_process";
import {
  createShipLearningEntries,
  evaluateCiStatus,
  evaluateShipGate,
  interpretMergeOutcome,
  type CiCheckRun,
  type MergeMethod,
  type PullRequestState,
  type SubagentReview
} from "./ship.js";
import { appendLearning, appendTimeline, ensureProgress, writeProgress } from "./state.js";
import type { GateDecision } from "./types.js";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: readonly string[]): CommandResult;
}

export interface ShipPullRequestOptions {
  projectRoot: string;
  prNumber: number;
  taskId?: string;
  autoMerge?: boolean;
  qa?: "pass" | "fail" | "skipped";
  review?: "pass" | "fail" | "pending";
  reviews?: readonly SubagentReview[];
  scope?: "pass" | "fail";
  expectedReviewers?: string[];
  now?: Date;
  runner?: CommandRunner;
}

export interface ShipPullRequestResult {
  prNumber: number;
  prUrl?: string;
  state?: PullRequestState;
  ci: ReturnType<typeof evaluateCiStatus>;
  gate: GateDecision;
  merged: boolean;
  mergeCommitOid?: string | null;
  mergeAttempts: Array<{
    method: MergeMethod;
    exitCode: number;
    outcome: ReturnType<typeof interpretMergeOutcome>;
  }>;
  summary: string;
}

interface PullRequestView {
  number?: number;
  state?: PullRequestState;
  url?: string;
  mergeCommit?: { oid?: string | null } | null;
  statusCheckRollup?: unknown[];
}

export function shipPullRequest(options: ShipPullRequestOptions): ShipPullRequestResult {
  const runner = options.runner ?? new SpawnCommandRunner(options.projectRoot);
  const progress = ensureProgress(options.projectRoot, options.now);
  const view = readPullRequestView(runner, options.prNumber);
  const ci = evaluateCiStatus(toCiChecks(view.statusCheckRollup ?? []));
  const nextProgress = {
    ...progress,
    last_iter_at: (options.now ?? new Date()).toISOString(),
    stats: {
      ...progress.stats,
      ci_polls: progress.stats.ci_polls + 1
    }
  };
  writeProgress(options.projectRoot, nextProgress);

  const expectedReviewers = options.expectedReviewers ?? ["operator-review"];
  const reviews = options.reviews ?? buildReviews(options.review ?? "pending", expectedReviewers);
  const gate = evaluateShipGate({
    ci,
    qa: options.qa ?? "skipped",
    reviews,
    expectedReviewers,
    scope: options.scope ?? "pass",
    workingTree: isWorkingTreeClean(runner) ? "clean" : "dirty"
  });

  for (const entry of createShipLearningEntries(ci.learningKeys.map((key) => ({ key })))) {
    appendLearning(options.projectRoot, entry);
  }

  if (!gate.allowed) {
    appendTimeline(options.projectRoot, {
      stage: "ship",
      status: ci.ci === "fail" ? "fail" : "pending",
      input: { prNumber: options.prNumber },
      output: {
        message: "Ship gate did not pass.",
        ci,
        gate
      },
      evidence: ci.evidence
    });
    return {
      prNumber: options.prNumber,
      prUrl: view.url,
      state: view.state,
      ci,
      gate,
      merged: false,
      mergeCommitOid: view.mergeCommit?.oid ?? null,
      mergeAttempts: [],
      summary: `Ship gate blocked PR #${options.prNumber}: ${gate.reasons.join("; ")}`
    };
  }

  if (!options.autoMerge) {
    appendTimeline(options.projectRoot, {
      stage: "ship",
      status: "pass",
      input: { prNumber: options.prNumber },
      output: {
        message: "Ship gate passed; auto-merge is disabled.",
        ci,
        gate
      },
      evidence: ci.evidence
    });
    return {
      prNumber: options.prNumber,
      prUrl: view.url,
      state: view.state,
      ci,
      gate,
      merged: false,
      mergeCommitOid: view.mergeCommit?.oid ?? null,
      mergeAttempts: [],
      summary: `Ship gate passed for PR #${options.prNumber}; auto-merge disabled.`
    };
  }

  const mergeAttempts: ShipPullRequestResult["mergeAttempts"] = [];
  let method: MergeMethod | undefined = "squash";
  let latestView = view;

  while (method) {
    const mergeResult = runner.run("gh", [
      "pr",
      "merge",
      String(options.prNumber),
      `--${method}`,
      "--delete-branch"
    ]);
    latestView = readPullRequestView(runner, options.prNumber);
    const outcome = interpretMergeOutcome({
      attempted: method,
      exitCode: mergeResult.exitCode,
      stderr: mergeResult.stderr,
      prState: latestView.state,
      mergeCommitOid: latestView.mergeCommit?.oid ?? null
    });
    mergeAttempts.push({ method, exitCode: mergeResult.exitCode, outcome });
    for (const entry of createShipLearningEntries(outcome.learningKeys.map((key) => ({ key })))) {
      appendLearning(options.projectRoot, entry);
    }

    if (outcome.status === "merged") {
      markTaskCompleted(options.projectRoot, options.taskId);
      appendTimeline(options.projectRoot, {
        stage: "ship",
        status: "pass",
        input: { prNumber: options.prNumber, taskId: options.taskId },
        output: {
          message: outcome.reason,
          ci,
          gate,
          mergeAttempts,
          mergeCommitOid: latestView.mergeCommit?.oid ?? null
        },
        evidence: ci.evidence
      });
      return {
        prNumber: options.prNumber,
        prUrl: latestView.url,
        state: latestView.state,
        ci,
        gate,
        merged: true,
        mergeCommitOid: latestView.mergeCommit?.oid ?? null,
        mergeAttempts,
        summary: `Merged PR #${options.prNumber}.`
      };
    }
    if (outcome.status === "retry") {
      method = outcome.nextMethod;
      continue;
    }
    method = undefined;
  }

  appendTimeline(options.projectRoot, {
    stage: "ship",
    status: "fail",
    input: { prNumber: options.prNumber, taskId: options.taskId },
    output: {
      message: "Ship merge did not complete.",
      ci,
      gate,
      mergeAttempts,
      mergeCommitOid: latestView.mergeCommit?.oid ?? null
    },
    evidence: ci.evidence
  });
  return {
    prNumber: options.prNumber,
    prUrl: latestView.url,
    state: latestView.state,
    ci,
    gate,
    merged: false,
    mergeCommitOid: latestView.mergeCommit?.oid ?? null,
    mergeAttempts,
    summary: `Ship merge did not complete for PR #${options.prNumber}.`
  };
}

function readPullRequestView(runner: CommandRunner, prNumber: number): PullRequestView {
  const result = runner.run("gh", [
    "pr",
    "view",
    String(prNumber),
    "--json",
    "number,state,url,mergeCommit,statusCheckRollup"
  ]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Failed to read PR #${prNumber}.`);
  }
  return JSON.parse(result.stdout) as PullRequestView;
}

function toCiChecks(rollup: readonly unknown[]): CiCheckRun[] {
  return rollup.map((item) => {
    const check = item as Record<string, unknown>;
    const name = String(check.name ?? "unknown");
    const workflowName = typeof check.workflowName === "string" ? check.workflowName : undefined;
    const status = String(check.status ?? "");
    const conclusion = typeof check.conclusion === "string" ? check.conclusion : "";
    const required = conclusion.toUpperCase() === "SKIPPED" && isKnownNonRequiredCheck(name, workflowName)
      ? false
      : undefined;
    return {
      name,
      workflowName,
      status,
      conclusion,
      detailsUrl: typeof check.detailsUrl === "string" ? check.detailsUrl : undefined,
      required
    };
  });
}

function isKnownNonRequiredCheck(name: string, workflowName?: string): boolean {
  const label = workflowName ? `${workflowName}: ${name}` : name;
  return /^Dependabot Auto-Merge: auto-merge$/i.test(label);
}

function buildReviews(status: "pass" | "fail" | "pending", reviewers: readonly string[]): SubagentReview[] {
  return reviewers.map((reviewer) => ({ reviewer, status }));
}

function isWorkingTreeClean(runner: CommandRunner): boolean {
  const result = runner.run("git", ["status", "--short"]);
  return result.exitCode === 0 && result.stdout.trim() === "";
}

function markTaskCompleted(projectRoot: string, taskId: string | undefined): void {
  if (!taskId) {
    return;
  }
  const progress = ensureProgress(projectRoot);
  if (!progress.completed.includes(taskId)) {
    progress.completed.push(taskId);
  }
  if (progress.active?.id === taskId) {
    progress.active = null;
  }
  writeProgress(projectRoot, progress);
}

export class SpawnCommandRunner implements CommandRunner {
  constructor(private readonly cwd: string) {}

  run(command: string, args: readonly string[]): CommandResult {
    const result = spawnSync(command, args, {
      cwd: this.cwd,
      encoding: "utf8",
      shell: false
    });
    return {
      exitCode: typeof result.status === "number" ? result.status : 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? (result.error ? String(result.error) : "")
    };
  }
}
