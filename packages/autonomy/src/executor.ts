import * as fs from "node:fs";
import * as path from "node:path";
import { classifyToolFailure } from "./failures.js";
import type { CommandRunner } from "./githubShip.js";
import { appendTimeline, ensureProgress, stateDir, writeProgress } from "./state.js";
import type { AutonomyConfig, StageResult, TaskBrief } from "./types.js";

export interface ExecuteTaskOptions {
  projectRoot: string;
  config: AutonomyConfig;
  task: TaskBrief;
  runner: CommandRunner;
}

export interface ExecuteTaskResult extends StageResult {
  promptPath: string;
  prNumber?: number;
  prUrl?: string;
  branch?: string;
  tests?: string[];
}

interface ExecutorCompletion {
  prNumber?: number;
  prUrl?: string;
  branch?: string;
  tests?: string[];
  summary?: string;
}

export function executeTask(options: ExecuteTaskOptions): ExecuteTaskResult {
  const promptPath = writeExecutorPrompt(options.projectRoot, options.task);
  const command = resolveExecutorCommand(options.projectRoot, options.config, promptPath, options.task);
  if (!command) {
    const summary = "Executor command is not configured.";
    recordExecutorFailure(options, summary, promptPath);
    return {
      status: "escalated",
      evidence: [promptPath],
      summary,
      failureClass: "UNCLASSIFIED",
      promptPath
    };
  }

  const result = options.runner.run(command[0], command.slice(1), {
    timeoutMs: options.config.executors?.customCommand?.timeoutMs
  });
  const progress = ensureProgress(options.projectRoot);
  progress.stats.executor_calls += 1;
  progress.last_iter_at = new Date().toISOString();
  progress.active = {
    id: options.task.id,
    title: options.task.title,
    pr_number: progress.active?.id === options.task.id ? progress.active.pr_number : null,
    branch: progress.active?.id === options.task.id ? progress.active.branch : null,
    stage: "build",
    started_at: progress.active?.id === options.task.id ? progress.active.started_at : new Date().toISOString(),
    last_attempt_at: new Date().toISOString()
  };
  writeProgress(options.projectRoot, progress);

  if (result.exitCode !== 0) {
    const failureClass = result.timedOut ? "CODEX_HANG" : classifyToolFailure(result.stderr);
    appendTimeline(options.projectRoot, {
      stage: "build",
      status: "fail",
      input: { task: options.task, command: redactCommand(command) },
      output: { stdout: result.stdout, stderr: result.stderr },
      evidence: [promptPath],
      failureClass
    });
    return {
      status: "fail",
      evidence: [promptPath],
      summary: result.stderr.trim() || `Executor failed with exit code ${result.exitCode}.`,
      failureClass,
      promptPath
    };
  }

  const completion = parseExecutorCompletion(result.stdout);
  if (completion) {
    const nextProgress = ensureProgress(options.projectRoot);
    nextProgress.active = {
      id: options.task.id,
      title: options.task.title,
      pr_number: completion.prNumber ?? nextProgress.active?.pr_number ?? null,
      branch: completion.branch ?? nextProgress.active?.branch ?? null,
      stage: completion.prNumber ? "ship" : "build",
      started_at: nextProgress.active?.id === options.task.id ? nextProgress.active.started_at : new Date().toISOString(),
      last_attempt_at: new Date().toISOString()
    };
    nextProgress.last_iter_at = new Date().toISOString();
    writeProgress(options.projectRoot, nextProgress);
  }

  appendTimeline(options.projectRoot, {
    stage: "build",
    status: "pass",
    input: { task: options.task, command: redactCommand(command) },
    output: { stdout: result.stdout, completion },
    evidence: [promptPath, ...(completion?.prUrl ? [completion.prUrl] : [])]
  });
  return {
    status: "pass",
    evidence: [promptPath, ...(completion?.prUrl ? [completion.prUrl] : [])],
    summary: completion?.summary ?? (result.stdout.trim() || `Executor completed for ${options.task.id}.`),
    promptPath,
    prNumber: completion?.prNumber,
    prUrl: completion?.prUrl,
    branch: completion?.branch,
    tests: completion?.tests
  };
}

export function writeExecutorPrompt(projectRoot: string, task: TaskBrief): string {
  fs.mkdirSync(stateDir(projectRoot), { recursive: true });
  const target = path.join(stateDir(projectRoot), `executor-prompt-${safeFileToken(task.id)}.md`);
  assertContainedPath(stateDir(projectRoot), target);
  fs.writeFileSync(target, renderExecutorPrompt(task), { mode: 0o600 });
  return path.relative(projectRoot, target);
}

function resolveExecutorCommand(
  projectRoot: string,
  config: AutonomyConfig,
  promptPath: string,
  task: TaskBrief
): string[] | null {
  const custom = config.executors?.customCommand?.command;
  if (custom?.length) {
    return expandCommand(custom, promptPath, task);
  }
  const prompt = fs.readFileSync(path.join(projectRoot, promptPath), "utf8");
  if (config.adapters.executor === "codex") {
    return ["codex", "exec", "--cd", ".", prompt];
  }
  if (config.adapters.executor === "claude") {
    return ["claude", "--print", prompt];
  }
  return null;
}

function expandCommand(command: readonly string[], promptPath: string, task: TaskBrief): string[] {
  return command.map((part) =>
    part
      .replaceAll("{promptPath}", promptPath)
      .replaceAll("{taskId}", task.id)
      .replaceAll("{taskTitle}", task.title)
  );
}

function renderExecutorPrompt(task: TaskBrief): string {
  return [
    `Implement ${task.id}: ${task.title}`,
    "",
    "Read AGENTS.md and the relevant .agents rules/skills before editing.",
    "Keep one PR scoped to this task.",
    "",
    "Deliverable:",
    task.deliverable,
    "",
    "Expected scope:",
    ...(task.expectedScope.length > 0 ? task.expectedScope.map((scope) => `- ${scope}`) : ["- Not specified"]),
    "",
    "Before publishing, run the appropriate focused tests and keep the working tree clean.",
    "",
    "When finished, print a final JSON object on stdout if the task produced a PR:",
    "{\"prNumber\":123,\"prUrl\":\"https://github.com/OWNER/REPO/pull/123\",\"branch\":\"branch-name\",\"tests\":[\"pnpm test\"],\"summary\":\"what changed\"}"
  ].join("\n");
}

function parseExecutorCompletion(stdout: string): ExecutorCompletion | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  for (const candidate of findJsonCandidates(trimmed).reverse()) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!isRecord(parsed)) {
        continue;
      }
      const completion: ExecutorCompletion = {};
      if (typeof parsed.prNumber === "number" && Number.isSafeInteger(parsed.prNumber) && parsed.prNumber > 0) {
        completion.prNumber = parsed.prNumber;
      }
      if (typeof parsed.prUrl === "string" && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(parsed.prUrl)) {
        completion.prUrl = parsed.prUrl;
        const parsedPrNumber = Number.parseInt(parsed.prUrl.match(/\/pull\/(\d+)$/)?.[1] ?? "", 10);
        if (Number.isSafeInteger(parsedPrNumber) && parsedPrNumber > 0) {
          completion.prNumber ??= parsedPrNumber;
        }
      }
      if (typeof parsed.branch === "string" && parsed.branch.trim().length > 0) {
        completion.branch = parsed.branch.trim();
      }
      if (Array.isArray(parsed.tests)) {
        completion.tests = parsed.tests.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
      }
      if (typeof parsed.summary === "string" && parsed.summary.trim().length > 0) {
        completion.summary = parsed.summary.trim();
      }
      return Object.keys(completion).length > 0 ? completion : null;
    } catch {
      continue;
    }
  }
  return null;
}

function findJsonCandidates(stdout: string): string[] {
  const candidates: string[] = [];
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("{") && line.endsWith("}")) {
      candidates.push(line);
    }
  }
  const first = stdout.indexOf("{");
  const last = stdout.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(stdout.slice(first, last + 1));
  }
  return candidates;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordExecutorFailure(
  options: ExecuteTaskOptions,
  summary: string,
  promptPath: string
): void {
  appendTimeline(options.projectRoot, {
    stage: "build",
    status: "fail",
    input: { task: options.task },
    output: { message: summary },
    evidence: [promptPath],
    failureClass: "UNCLASSIFIED"
  });
}

function redactCommand(command: readonly string[]): string[] {
  return command.map((part) => (part.length > 240 ? `${part.slice(0, 240)}...` : part));
}

function safeFileToken(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function assertContainedPath(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Executor prompt path escaped .agents/state.");
  }
}
