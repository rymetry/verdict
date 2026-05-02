#!/usr/bin/env node
import * as path from "node:path";
import { drive } from "./driver.js";
import { publishCurrentBranch } from "./githubPublish.js";
import { shipPullRequest, SpawnCommandRunner } from "./githubShip.js";
import { loadReviewInput } from "./reviewInput.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

try {
  const projectRoot = readPathArg(args, "--cwd", process.env.INIT_CWD ?? process.cwd());
  const runner = new SpawnCommandRunner(projectRoot);
  const publishCurrent = args.includes("--publish-current");
  const shipPr = readNumberArg(args, "--ship-pr");
  const reviewFile = readOptionalArg(args, "--review-file");
  const reviewInput = reviewFile ? loadReviewInput(projectRoot, reviewFile) : undefined;
  const result = publishCurrent
    ? publishCurrentBranch({
        projectRoot,
        title: readRequiredArg(args, "--title"),
        bodyFile: readRequiredArg(args, "--body-file"),
        base: readOptionalArg(args, "--base"),
        head: readOptionalArg(args, "--head"),
        taskId: readOptionalArg(args, "--task-id"),
        draft: args.includes("--draft"),
        runner
      })
    : shipPr
      ? shipPullRequest({
          projectRoot,
          prNumber: shipPr,
          taskId: readOptionalArg(args, "--task-id"),
          autoMerge: args.includes("--auto-merge"),
          qa: args.includes("--qa-pass") ? "pass" : "skipped",
          review: args.includes("--review-pass") ? "pass" : "pending",
          reviews: reviewInput?.reviews,
          expectedReviewers: reviewInput?.expectedReviewers,
          scope: args.includes("--scope-fail") ? "fail" : "pass"
        })
      : drive({ projectRoot, dryRun });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}

function readPathArg(args: string[], flag: string, fallback: string): string {
  const base = process.env.INIT_CWD ?? process.cwd();
  const index = args.indexOf(flag);
  if (index === -1) {
    return path.resolve(fallback);
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a path value`);
  }
  return path.resolve(base, value);
}

function readOptionalArg(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readRequiredArg(args: string[], flag: string): string {
  const value = readOptionalArg(args, flag);
  if (value === undefined) {
    throw new Error(`${flag} is required`);
  }
  return value;
}

function readNumberArg(args: string[], flag: string): number | undefined {
  const value = readOptionalArg(args, flag);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}
