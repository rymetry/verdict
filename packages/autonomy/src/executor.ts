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

  appendTimeline(options.projectRoot, {
    stage: "build",
    status: "pass",
    input: { task: options.task, command: redactCommand(command) },
    output: { stdout: result.stdout },
    evidence: [promptPath]
  });
  return {
    status: "pass",
    evidence: [promptPath],
    summary: result.stdout.trim() || `Executor completed for ${options.task.id}.`,
    promptPath
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
    "Before publishing, run the appropriate focused tests and keep the working tree clean."
  ].join("\n");
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
