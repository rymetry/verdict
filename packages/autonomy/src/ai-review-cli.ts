#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { classifyToolFailure } from "./failures.js";
import { SpawnCommandRunner, type CommandRunner } from "./githubShip.js";
import { parseReviewInput, type ReviewInputFile } from "./reviewInput.js";

export type AiReviewRuntime = "codex" | "claude";

export interface AiReviewCliEnvironment {
  cwd: string;
  stdout: Pick<typeof process.stdout, "write">;
  stderr: Pick<typeof process.stderr, "write">;
}

export function runAiReviewCli(
  args: string[],
  environment: AiReviewCliEnvironment,
  runner?: CommandRunner
): number {
  try {
    const projectRoot = readPathArg(args, "--cwd", environment.cwd);
    const prNumber = readRequiredArg(args, "--pr");
    const runtime = readRuntime(args);
    const reviewer = readOptionalArg(args, "--reviewer") ?? `${runtime}-review`;
    const timeoutMs = readNumberArg(args, "--timeout-ms") ?? 300_000;
    const commandRunner = runner ?? new SpawnCommandRunner(projectRoot);

    const diffResult = commandRunner.run("gh", ["pr", "diff", prNumber], { timeoutMs: 60_000 });
    if (diffResult.exitCode !== 0) {
      throw new Error(diffResult.stderr.trim() || `Failed to read PR #${prNumber} diff.`);
    }

    const prompt = buildAiReviewPrompt({ prNumber, reviewer, diff: diffResult.stdout });
    const aiCommand = buildRuntimeCommand(runtime, prompt);
    const aiResult = commandRunner.run(aiCommand[0], aiCommand.slice(1), { timeoutMs });
    if (aiResult.exitCode !== 0) {
      const failureClass = aiResult.timedOut ? "CODEX_HANG" : classifyToolFailure(aiResult.stderr);
      throw new Error(
        aiResult.stderr.trim() ||
          `${runtime} review command failed with exit code ${aiResult.exitCode} (${failureClass}).`
      );
    }

    const parsed = normalizeAiReviewOutput(aiResult.stdout, reviewer);
    environment.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    environment.stderr.write(`${message}\n`);
    return 1;
  }
}

export function buildAiReviewPrompt(input: {
  prNumber: string;
  reviewer: string;
  diff: string;
}): string {
  return [
    `Review GitHub PR #${input.prNumber} as ${input.reviewer}.`,
    "",
    "Focus on bugs, production risks, security/privacy regressions, missing tests, and scope violations.",
    "Do not request unrelated refactors or style-only churn.",
    "Return only valid JSON matching this schema:",
    "",
    "{",
    '  "expectedReviewers": ["reviewer-name"],',
    '  "reviews": [',
    "    {",
    '      "reviewer": "reviewer-name",',
    '      "status": "pass | fail | pending",',
    '      "findings": [',
    "        {",
    '          "priority": 0,',
    '          "title": "short title",',
    '          "body": "one paragraph with file/line evidence when available",',
    '          "file": "relative/path.ts",',
    '          "line": 123',
    '        }',
    "      ],",
    '      "summary": "brief review summary"',
    "    }",
    "  ]",
    "}",
    "",
    "Use priority 0 or 1 only for issues that should block merge.",
    `Set expectedReviewers to ["${input.reviewer}"].`,
    "",
    "Diff:",
    "```diff",
    input.diff,
    "```"
  ].join("\n");
}

export function buildRuntimeCommand(runtime: AiReviewRuntime, prompt: string): string[] {
  if (runtime === "codex") {
    return ["codex", "exec", "--cd", ".", prompt];
  }
  return ["claude", "--print", prompt];
}

export function normalizeAiReviewOutput(raw: string, reviewer: string): ReviewInputFile {
  const parsed = parseReviewInput(extractJson(raw));
  return {
    expectedReviewers: parsed.expectedReviewers?.length ? parsed.expectedReviewers : [reviewer],
    reviews: parsed.reviews.map((review) => ({
      ...review,
      reviewer: review.reviewer || reviewer
    }))
  };
}

function extractJson(raw: string): string {
  try {
    parseReviewInput(raw);
    return raw;
  } catch {
    // Continue with markdown/code-fence extraction.
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  const objectStart = raw.indexOf("{");
  const objectEnd = raw.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return raw.slice(objectStart, objectEnd + 1);
  }
  const arrayStart = raw.indexOf("[");
  const arrayEnd = raw.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return raw.slice(arrayStart, arrayEnd + 1);
  }
  return raw;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = runAiReviewCli(process.argv.slice(2), {
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

function readRuntime(args: string[]): AiReviewRuntime {
  const value = readOptionalArg(args, "--runtime") ?? "codex";
  if (value !== "codex" && value !== "claude") {
    throw new Error("--runtime must be codex or claude");
  }
  return value;
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
