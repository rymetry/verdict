#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { SpawnCommandRunner } from "./githubShip.js";
import { reviewPullRequestDiff } from "./prReview.js";

export interface ReviewCliEnvironment {
  cwd: string;
  stdout: Pick<typeof process.stdout, "write">;
  stderr: Pick<typeof process.stderr, "write">;
}

export function runReviewCli(args: string[], environment: ReviewCliEnvironment): number {
  try {
    const projectRoot = readPathArg(args, "--cwd", environment.cwd);
    const prNumber = readRequiredArg(args, "--pr");
    const reviewer = readOptionalArg(args, "--reviewer");
    const runner = new SpawnCommandRunner(projectRoot);
    const diffResult = runner.run("gh", ["pr", "diff", prNumber], { timeoutMs: 60_000 });
    if (diffResult.exitCode !== 0) {
      throw new Error(diffResult.stderr.trim() || `Failed to read PR #${prNumber} diff.`);
    }
    environment.stdout.write(`${JSON.stringify(reviewPullRequestDiff({ diff: diffResult.stdout, reviewer }), null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    environment.stderr.write(`${message}\n`);
    return 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = runReviewCli(process.argv.slice(2), {
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr
  });
}

function isMainModule(moduleUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) {
    return false;
  }
  return moduleUrl === pathToFileURL(fs.realpathSync(argvPath)).href;
}

function readPathArg(args: string[], flag: string, fallback: string): string {
  const value = readOptionalArg(args, flag);
  return path.resolve(value ?? fallback);
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
