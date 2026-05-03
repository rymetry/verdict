import { evaluateMergeGate } from "./policy.js";
import type { GateDecision, LearningEntry, MergeGateInput, ProgressState } from "./types.js";

export type CiCheckStatus = "QUEUED" | "IN_PROGRESS" | "COMPLETED" | string;
export type CiCheckConclusion =
  | "SUCCESS"
  | "FAILURE"
  | "CANCELLED"
  | "TIMED_OUT"
  | "SKIPPED"
  | "NEUTRAL"
  | ""
  | null
  | string;

export interface CiCheckRun {
  name: string;
  status: CiCheckStatus;
  conclusion?: CiCheckConclusion;
  workflowName?: string;
  detailsUrl?: string;
  /**
   * Defaults to unknown. Skipped checks are safe to ignore only when the adapter
   * explicitly marks them as non-required.
   */
  required?: boolean;
}

export interface CiStatusDecision {
  ci: MergeGateInput["ci"];
  passed: string[];
  neutral: string[];
  pending: string[];
  failed: string[];
  skipped: string[];
  evidence: string[];
  learningKeys: ShipLearningKey[];
}

export interface ReviewFinding {
  priority: 0 | 1 | 2 | 3;
  title: string;
  body?: string;
  file?: string;
  line?: number;
  source?: string;
}

export interface SubagentReview {
  reviewer: string;
  status: "pass" | "fail" | "pending";
  findings?: ReviewFinding[];
  summary?: string;
}

export interface ReviewGateDecision {
  review: MergeGateInput["review"];
  allowed: boolean;
  reasons: string[];
  blockerFindings: ReviewFinding[];
}

export interface ReviewGateInput {
  reviews: readonly SubagentReview[];
  expectedReviewers: readonly string[];
}

export interface ShipGateInput {
  ci: CiStatusDecision;
  qa: MergeGateInput["qa"];
  reviews: readonly SubagentReview[];
  expectedReviewers: readonly string[];
  scope: MergeGateInput["scope"];
  workingTree: MergeGateInput["workingTree"];
}

export interface ShipGateDecision extends GateDecision {
  mergeInput: MergeGateInput;
  reviewDecision: ReviewGateDecision;
}

export type MergeMethod = "squash" | "merge" | "rebase";
export type PullRequestState = "OPEN" | "MERGED" | "CLOSED";

export interface MergeAttempt {
  method: MergeMethod;
  status: "failed" | "merged";
  stderr?: string;
}

export interface MergeOutcomeInput {
  attempted: MergeMethod;
  exitCode: number;
  stderr?: string;
  prState?: PullRequestState;
  mergeCommitOid?: string | null;
}

export interface MergeOutcomeDecision {
  status: "merged" | "retry" | "waiting" | "failed";
  nextMethod?: MergeMethod;
  reason: string;
  learningKeys: ShipLearningKey[];
}

export interface ShipLearningEvent {
  key: ShipLearningKey;
  source?: LearningEntry["source"];
}

export type ShipLearningKey =
  | "github-ci-skipped-nonrequired-checks"
  | "github-squash-merge-disabled"
  | "github-merge-local-worktree-post-merge-error";

export function evaluateCiStatus(checks: readonly CiCheckRun[]): CiStatusDecision {
  const passed: string[] = [];
  const neutral: string[] = [];
  const pending: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  const ignoredSkipped: string[] = [];
  const evidence: string[] = [];

  for (const check of checks) {
    const label = formatCheckLabel(check);
    if (check.detailsUrl) {
      evidence.push(check.detailsUrl);
    }

    const status = normalize(check.status);
    const conclusion = normalize(check.conclusion ?? "");
    if (status !== "COMPLETED") {
      pending.push(label);
      continue;
    }

    if (conclusion === "SKIPPED") {
      skipped.push(label);
      if (check.required !== false) {
        failed.push(`${label} was skipped without explicit non-required status`);
      } else {
        ignoredSkipped.push(label);
      }
      continue;
    }

    if (conclusion === "SUCCESS") {
      passed.push(label);
      continue;
    }
    if (conclusion === "NEUTRAL") {
      neutral.push(label);
      continue;
    }

    if (!conclusion) {
      pending.push(label);
      continue;
    }

    failed.push(`${label} concluded ${conclusion.toLowerCase()}`);
  }

  if (failed.length > 0) {
    return {
      ci: "fail",
      passed,
      neutral,
      pending,
      failed,
      skipped,
      evidence,
      learningKeys: ignoredSkipped.length > 0 ? ["github-ci-skipped-nonrequired-checks"] : []
    };
  }
  if (pending.length > 0 || passed.length === 0) {
    return {
      ci: "pending",
      passed,
      neutral,
      pending:
        passed.length === 0 && pending.length === 0
          ? ["No completed successful non-skipped checks"]
          : pending,
      failed,
      skipped,
      evidence,
      learningKeys: ignoredSkipped.length > 0 ? ["github-ci-skipped-nonrequired-checks"] : []
    };
  }
  return {
    ci: "pass",
    passed,
    neutral,
    pending,
    failed,
    skipped,
    evidence,
    learningKeys: ignoredSkipped.length > 0 ? ["github-ci-skipped-nonrequired-checks"] : []
  };
}

export function recordCiPoll(progress: ProgressState, decision: CiStatusDecision, now = new Date()): ProgressState {
  return {
    ...progress,
    last_iter_at: now.toISOString(),
    stats: {
      ...progress.stats,
      ci_polls: progress.stats.ci_polls + 1
    },
    active: progress.active
      ? {
          ...progress.active,
          last_attempt_at: now.toISOString(),
          stage: "ship"
        }
      : progress.active,
    escalated:
      decision.ci === "fail"
        ? [
            ...progress.escalated,
            {
              id: progress.active?.id ?? "ci",
              at: now.toISOString(),
              class: "RECURRING_CI_FAILURE",
              reason: decision.failed.join("; ")
            }
          ]
        : progress.escalated
  };
}

export function evaluateReviewGate(input: ReviewGateInput): ReviewGateDecision {
  const reviews = input.reviews;
  const expectedReviewers = input.expectedReviewers;
  if (reviews.length === 0) {
    return {
      review: "fail",
      allowed: false,
      reasons: ["AI review has not run"],
      blockerFindings: []
    };
  }

  const reasons: string[] = [];
  const blockerFindings: ReviewFinding[] = [];
  const seenReviewers = new Set(reviews.map((review) => review.reviewer));
  for (const reviewer of expectedReviewers) {
    if (!seenReviewers.has(reviewer)) {
      reasons.push(`${reviewer} review is missing`);
    }
  }
  for (const review of reviews) {
    if (review.status === "pending") {
      reasons.push(`${review.reviewer} review is pending`);
      continue;
    }
    if (review.status === "fail") {
      reasons.push(`${review.reviewer} review failed`);
    }
    for (const finding of review.findings ?? []) {
      if (finding.priority <= 2) {
        blockerFindings.push({ ...finding, source: finding.source ?? review.reviewer });
      }
    }
  }

  if (blockerFindings.some((finding) => finding.priority <= 1)) {
    return {
      review: "p0-p1",
      allowed: false,
      reasons: [...reasons, "AI review found P0/P1 issues"],
      blockerFindings
    };
  }
  if (blockerFindings.length > 0) {
    return {
      review: "fail",
      allowed: false,
      reasons: [...reasons, "AI review found P2 issues"],
      blockerFindings
    };
  }
  if (reasons.length > 0) {
    return {
      review: "fail",
      allowed: false,
      reasons,
      blockerFindings
    };
  }

  return {
    review: "pass",
    allowed: true,
    reasons: [],
    blockerFindings
  };
}

export function evaluateShipGate(input: ShipGateInput): ShipGateDecision {
  const reviewDecision = evaluateReviewGate({
    reviews: input.reviews,
    expectedReviewers: input.expectedReviewers
  });
  const mergeInput: MergeGateInput = {
    ci: input.ci.ci,
    qa: input.qa,
    review: reviewDecision.review,
    scope: input.scope,
    workingTree: input.workingTree
  };
  const mergeDecision = evaluateMergeGate(mergeInput);
  const mergeReasons = mergeDecision.reasons.filter(
    (reason) => !(reason === "AI review failed" && reviewDecision.reasons.length > 0)
  );
  return {
    allowed: reviewDecision.allowed && mergeDecision.allowed,
    reasons: [...new Set([...reviewDecision.reasons, ...mergeReasons])],
    mergeInput,
    reviewDecision
  };
}

export function chooseNextMergeMethod(attempts: readonly MergeAttempt[]): MergeMethod | null {
  if (attempts.length === 0) {
    return "squash";
  }
  const last = attempts[attempts.length - 1];
  if (last?.status === "merged") {
    return null;
  }
  if (last?.method === "squash" && last.stderr && isSquashDisabled(last.stderr)) {
    return "merge";
  }
  return null;
}

export function interpretMergeOutcome(input: MergeOutcomeInput): MergeOutcomeDecision {
  const stderr = input.stderr ?? "";
  if (input.exitCode !== 0 && input.attempted === "squash" && isSquashDisabled(stderr)) {
    return {
      status: "retry",
      nextMethod: "merge",
      reason: "Squash merge is disabled for this repository; retry with merge commit.",
      learningKeys: ["github-squash-merge-disabled"]
    };
  }
  if (input.prState === "CLOSED") {
    return {
      status: "failed",
      reason: stderr.trim() || "Pull request is closed without a confirmed merge.",
      learningKeys: []
    };
  }
  if (input.prState === "OPEN") {
    return {
      status: "waiting",
      reason:
        input.exitCode === 0
          ? "Merge command completed but the pull request is still open; poll PR state before marking Ship as merged."
          : stderr.trim() || "Merge command failed while the pull request is still open.",
      learningKeys: []
    };
  }
  if (input.prState === "MERGED") {
    return {
      status: "merged",
      reason:
        input.exitCode === 0
          ? "Pull request merged."
          : "Pull request is merged even though the local merge command returned an error.",
      learningKeys: isLocalMainWorktreeError(stderr)
        ? ["github-merge-local-worktree-post-merge-error"]
        : []
    };
  }
  if (input.exitCode === 0) {
    return {
      status: "waiting",
      reason: "Merge command completed; confirm PR state before marking Ship as merged.",
      learningKeys: []
    };
  }
  return {
    status: "failed",
    reason: stderr.trim() || `Merge command failed with exit code ${input.exitCode}.`,
    learningKeys: []
  };
}

export function createShipLearningEntries(
  events: readonly ShipLearningEvent[]
): Array<Omit<LearningEntry, "at">> {
  return events.map((event) => {
    return {
      key: event.key,
      type: learningType(event.key),
      insight: learningInsight(event.key),
      source: event.source ?? "driver"
    };
  });
}

function normalize(value: string | null): string {
  return (value ?? "").trim().toUpperCase();
}

function formatCheckLabel(check: CiCheckRun): string {
  return check.workflowName ? `${check.workflowName}: ${check.name}` : check.name;
}

function isSquashDisabled(stderr: string): boolean {
  return /squash (merges? )?(are |is )?(not allowed|disabled|disallowed)|repository does not allow squash/i.test(
    stderr
  );
}

function isLocalMainWorktreeError(stderr: string): boolean {
  return /'main' is already used by worktree/i.test(stderr);
}

function learningType(key: ShipLearningKey): LearningEntry["type"] {
  if (key === "github-merge-local-worktree-post-merge-error") {
    return "environment";
  }
  if (key === "github-squash-merge-disabled") {
    return "decision";
  }
  return "tool";
}

function learningInsight(key: ShipLearningKey): string {
  if (key === "github-ci-skipped-nonrequired-checks") {
    return "Ship CI polling should ignore non-required skipped checks while still requiring at least one completed passing check.";
  }
  if (key === "github-squash-merge-disabled") {
    return "When GitHub rejects squash merge because the repository disallows it, retry the Ship merge step with a merge commit.";
  }
  return "If gh reports the local main worktree error after merge, verify PR state before treating the Ship step as failed.";
}
