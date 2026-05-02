#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { runDeployMonitor } from "./deploy.js";
import { drive } from "./driver.js";
import { publishCurrentBranch } from "./githubPublish.js";
import { shipPullRequest, SpawnCommandRunner } from "./githubShip.js";
import { loadReviewInput } from "./reviewInput.js";
import { runStructuredReview } from "./reviewer.js";

export interface CliEnvironment {
  cwd: string;
  initCwd?: string;
  stdout: Pick<typeof process.stdout, "write">;
  stderr: Pick<typeof process.stderr, "write">;
}

export function runCli(args: string[], environment: CliEnvironment): number {
  const dryRun = args.includes("--dry-run");
  try {
    const projectRoot = readPathArg(args, "--cwd", environment.initCwd ?? environment.cwd, environment);
    const runner = new SpawnCommandRunner(projectRoot);
    const publishCurrent = args.includes("--publish-current");
    const runDeploy = args.includes("--run-deploy");
    const shipPr = readNumberArg(args, "--ship-pr");
    const reviewPr = readNumberArg(args, "--run-review");
    if (runDeploy && (publishCurrent || shipPr !== undefined || reviewPr !== undefined)) {
      throw new Error("--run-deploy cannot be combined with publish, review, or ship commands.");
    }
    if (reviewPr !== undefined && shipPr !== undefined && reviewPr !== shipPr) {
      throw new Error("--run-review and --ship-pr must reference the same PR.");
    }
    const reviewFile = readOptionalArg(args, "--review-file");
    if (reviewPr !== undefined && reviewFile !== undefined) {
      throw new Error("--run-review cannot be combined with --review-file.");
    }
    const reviewResult = reviewPr
      ? runStructuredReview({
          projectRoot,
          config: loadConfig(projectRoot),
          prNumber: reviewPr,
          runner
        })
      : undefined;
    const resolvedReviewFile = reviewFile ?? reviewResult?.reviewFile;
    const reviewInput = resolvedReviewFile ? loadReviewInput(projectRoot, resolvedReviewFile) : undefined;
    const result = publishCurrent
      ? publishCurrentBranch({
          projectRoot,
          title: readOptionalArg(args, "--title"),
          bodyFile: readOptionalArg(args, "--body-file"),
          base: readOptionalArg(args, "--base"),
          head: readOptionalArg(args, "--head"),
          taskId: readOptionalArg(args, "--task-id"),
          draft: args.includes("--draft"),
          runner
        })
      : reviewPr && !shipPr
        ? reviewResult
        : runDeploy
          ? runDeployMonitor({
              projectRoot,
              taskId: readOptionalArg(args, "--task-id"),
              approvalGranted: args.includes("--approval-granted"),
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
    environment.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    environment.stderr.write(`${message}\n`);
    return 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    initCwd: process.env.INIT_CWD,
    stdout: process.stdout,
    stderr: process.stderr
  });
}

export function isMainModule(moduleUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) {
    return false;
  }
  return moduleUrl === pathToFileURL(fs.realpathSync(argvPath)).href;
}

function readPathArg(args: string[], flag: string, fallback: string, environment: CliEnvironment): string {
  const base = environment.initCwd ?? environment.cwd;
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
