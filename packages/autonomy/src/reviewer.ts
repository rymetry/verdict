import * as fs from "node:fs";
import * as path from "node:path";
import { classifyToolFailure } from "./failures.js";
import type { CommandRunner } from "./githubShip.js";
import { loadReviewInput, type ReviewInputFile } from "./reviewInput.js";
import { appendTimeline, ensureProgress, stateDir, writeProgress } from "./state.js";
import type { AutonomyConfig } from "./types.js";

export interface RunReviewOptions {
  projectRoot: string;
  config: AutonomyConfig;
  prNumber: number;
  runner: CommandRunner;
}

export interface RunReviewResult {
  reviewFile: string;
  reviewInput: ReviewInputFile;
  summary: string;
}

export function runStructuredReview(options: RunReviewOptions): RunReviewResult {
  const command = options.config.reviewers?.customCommand?.command;
  if (!command?.length) {
    const reviewFile = writePassingOperatorReview(options.projectRoot, options.prNumber, options.config);
    return {
      reviewFile,
      reviewInput: loadReviewInput(options.projectRoot, reviewFile),
      summary: "No review command configured; wrote explicit operator-review placeholder."
    };
  }

  const expanded = command.map((part) => part.replaceAll("{prNumber}", String(options.prNumber)));
  const result = options.runner.run(expanded[0], expanded.slice(1), {
    timeoutMs: options.config.reviewers?.customCommand?.timeoutMs
  });
  if (result.exitCode !== 0) {
    const failureClass = result.timedOut ? "CODEX_HANG" : classifyToolFailure(result.stderr);
    const failure = appendTimeline(options.projectRoot, {
      stage: "review",
      status: "fail",
      input: { prNumber: options.prNumber, command: expanded },
      output: { stdout: result.stdout, stderr: result.stderr },
      failureClass
    });
    const progress = ensureProgress(options.projectRoot);
    progress.escalated.push({
      id: `PR-${options.prNumber}:review`,
      at: failure.at,
      class: failureClass,
      reason: result.stderr.trim() || `Review command failed with exit code ${result.exitCode}.`
    });
    progress.last_iter_at = failure.at;
    writeProgress(options.projectRoot, progress);
    throw new Error(result.stderr.trim() || `Review command failed with exit code ${result.exitCode}.`);
  }

  const reviewFile = path.join(".agents", "state", `review-${options.prNumber}.json`);
  const target = path.join(options.projectRoot, reviewFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, result.stdout, { mode: 0o600 });
  const reviewInput = loadReviewInput(options.projectRoot, reviewFile);
  appendTimeline(options.projectRoot, {
    stage: "review",
    status: "pass",
    input: { prNumber: options.prNumber, command: expanded },
    output: { reviewFile, reviews: reviewInput.reviews },
    evidence: [reviewFile]
  });
  return {
    reviewFile,
    reviewInput,
    summary: `Wrote structured review for PR #${options.prNumber}.`
  };
}

function writePassingOperatorReview(
  projectRoot: string,
  prNumber: number,
  config: AutonomyConfig
): string {
  const expectedReviewers = config.reviewers?.customCommand?.expectedReviewers ?? ["operator-review"];
  const reviewFile = path.join(".agents", "state", `review-${prNumber}.json`);
  const target = path.join(projectRoot, reviewFile);
  fs.mkdirSync(stateDir(projectRoot), { recursive: true });
  fs.writeFileSync(
    target,
    `${JSON.stringify(
      {
        expectedReviewers,
        reviews: expectedReviewers.map((reviewer) => ({
          reviewer,
          status: "pending",
          findings: [],
          summary: "Review command is not configured."
        }))
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
  appendTimeline(projectRoot, {
    stage: "review",
    status: "pending",
    input: { prNumber },
    output: { reviewFile, message: "Review command is not configured." },
    evidence: [reviewFile]
  });
  return reviewFile;
}
