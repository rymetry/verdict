import * as fs from "node:fs";
import * as path from "node:path";
import { classifyToolFailure } from "./failures.js";
import type { CommandRunner } from "./githubShip.js";
import { loadReviewInput, parseReviewInput, type ReviewInputFile } from "./reviewInput.js";
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

interface ReviewCommandSpec {
  name: string;
  command: string[];
  expectedReviewers?: string[];
  timeoutMs?: number;
}

export function runStructuredReview(options: RunReviewOptions): RunReviewResult {
  const commands = resolveReviewCommands(options.config);
  if (commands.length === 0) {
    const reviewFile = writePassingOperatorReview(options.projectRoot, options.prNumber, options.config);
    return {
      reviewFile,
      reviewInput: loadReviewInput(options.projectRoot, reviewFile),
      summary: "No review command configured; wrote explicit operator-review placeholder."
    };
  }

  const merged: ReviewInputFile = { reviews: [], expectedReviewers: [] };
  const commandEvidence: Array<{ name: string; command: string[] }> = [];
  for (const command of commands) {
    const expanded = command.command.map((part) => part.replaceAll("{prNumber}", String(options.prNumber)));
    commandEvidence.push({ name: command.name, command: expanded });
    const result = options.runner.run(expanded[0], expanded.slice(1), {
      timeoutMs: command.timeoutMs
    });
    if (result.exitCode !== 0) {
      recordReviewCommandFailure(options, command.name, expanded, result);
    }
    const reviewInput = parseReviewInput(result.stdout);
    merged.reviews.push(...reviewInput.reviews);
    merged.expectedReviewers?.push(...(reviewInput.expectedReviewers ?? command.expectedReviewers ?? []));
  }
  merged.expectedReviewers = uniqueNonEmpty(merged.expectedReviewers ?? []);

  const reviewFile = path.join(".agents", "state", `review-${options.prNumber}.json`);
  const target = path.join(options.projectRoot, reviewFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  const reviewInput = loadReviewInput(options.projectRoot, reviewFile);
  appendTimeline(options.projectRoot, {
    stage: "review",
    status: "pass",
    input: { prNumber: options.prNumber, commands: commandEvidence },
    output: { reviewFile, reviews: reviewInput.reviews, expectedReviewers: reviewInput.expectedReviewers },
    evidence: [reviewFile]
  });
  return {
    reviewFile,
    reviewInput,
    summary: `Wrote ${reviewInput.reviews.length} structured reviews for PR #${options.prNumber}.`
  };
}

function resolveReviewCommands(config: AutonomyConfig): ReviewCommandSpec[] {
  const multi = config.reviewers?.customCommands ?? [];
  if (multi.length > 0) {
    return multi
      .filter((command) => command.command.length > 0)
      .map((command, index) => ({
        name: command.name ?? `review-command-${index + 1}`,
        command: command.command,
        expectedReviewers: command.expectedReviewers,
        timeoutMs: command.timeoutMs
      }));
  }
  const single = config.reviewers?.customCommand;
  return single?.command?.length
    ? [
        {
          name: "custom-command",
          command: single.command,
          expectedReviewers: single.expectedReviewers,
          timeoutMs: single.timeoutMs
        }
      ]
    : [];
}

function recordReviewCommandFailure(
  options: RunReviewOptions,
  name: string,
  command: string[],
  result: ReturnType<CommandRunner["run"]>
): never {
  const failureClass = result.timedOut ? "CODEX_HANG" : classifyToolFailure(result.stderr);
  const failure = appendTimeline(options.projectRoot, {
    stage: "review",
    status: "fail",
    input: { prNumber: options.prNumber, commandName: name, command },
    output: { stdout: result.stdout, stderr: result.stderr },
    failureClass
  });
  const progress = ensureProgress(options.projectRoot);
  progress.escalated.push({
    id: `PR-${options.prNumber}:review`,
    at: failure.at,
    class: failureClass,
    reason: result.stderr.trim() || `${name} review command failed with exit code ${result.exitCode}.`
  });
  progress.last_iter_at = failure.at;
  writeProgress(options.projectRoot, progress);
  throw new Error(result.stderr.trim() || `${name} review command failed with exit code ${result.exitCode}.`);
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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
