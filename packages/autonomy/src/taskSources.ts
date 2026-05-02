import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { readActiveTaskId } from "./state.js";
import type { AutonomyConfig, ProgressState, TaskBrief, TaskSelection } from "./types.js";

interface MarkdownTaskRow {
  id: string;
  title: string;
  sourcePath: string;
  line: number;
  raw: string;
}

export function pickTask(
  projectRoot: string,
  config: AutonomyConfig,
  progress: ProgressState
): TaskSelection {
  switch (config.adapters.taskSource) {
    case "markdown-roadmap":
      return pickMarkdownRoadmapTask(projectRoot, config, progress);
    case "custom-command":
      return pickCustomCommandTask(projectRoot, config, progress);
    default:
      return {
        task: null,
        warnings: [`Task source ${config.adapters.taskSource} is not implemented yet.`],
        evidence: [".agents/autonomy.config.json"]
      };
  }
}

export function pickMarkdownRoadmapTask(
  projectRoot: string,
  config: AutonomyConfig,
  progress: ProgressState
): TaskSelection {
  const activeTaskId = readActiveTaskId(progress);
  const evidence = [".agents/state/progress.json"];
  let sources: MarkdownTaskRow[];
  try {
    sources = readMarkdownRoadmapTasks(projectRoot, config);
  } catch (error) {
    return {
      task: null,
      warnings: [
        `Invalid markdown roadmap configuration: ${
          error instanceof Error ? error.message : String(error)
        }`
      ],
      evidence: [".agents/autonomy.config.json"],
      blockedReason: "roadmap-path-invalid"
    };
  }
  if (sources.length === 0) {
    return {
      task: null,
      warnings: [
        "No markdown roadmap tasks found. Add unchecked tasks like '- [ ] ROADMAP-1: Describe the work'."
      ],
      evidence: [".agents/autonomy.config.json"],
      blockedReason: "no-roadmap-tasks"
    };
  }

  const completed = new Set(progress.completed);
  if (activeTaskId !== null) {
    const active = sources.find((task) => task.id === activeTaskId && !completed.has(task.id));
    if (active) {
      return {
        task: taskBriefFromMarkdownRow(active, config),
        warnings: [`Retrying active task ${activeTaskId}.`],
        evidence: [...evidence, active.sourcePath]
      };
    }
    return {
      task: null,
      warnings: [`Active task ${activeTaskId} is already in progress but is not present in the roadmap.`],
      evidence,
      blockedReason: "active-task-in-progress"
    };
  }

  const next = sources.find((task) => !completed.has(task.id));
  if (!next) {
    return {
      task: null,
      warnings: [],
      evidence: [...evidence, ...unique(sources.map((task) => task.sourcePath))]
    };
  }

  return {
    task: taskBriefFromMarkdownRow(next, config),
    warnings: [],
    evidence: [...evidence, next.sourcePath]
  };
}

function taskBriefFromMarkdownRow(row: MarkdownTaskRow, config: AutonomyConfig): TaskBrief {
  return {
    id: row.id,
    title: row.title,
    deliverable: `${row.title} | ${row.sourcePath}:${row.line}`,
    expectedScope: inferExpectedScope(row.raw),
    highRisk: isTextHighRisk(`${row.id} ${row.title} ${row.raw}`, config)
  };
}

export function pickCustomCommandTask(
  projectRoot: string,
  config: AutonomyConfig,
  progress: ProgressState
): TaskSelection {
  const command = config.taskSources?.customCommand?.command;
  if (!command?.length) {
    return {
      task: null,
      warnings: ["Task source custom-command requires taskSources.customCommand.command."],
      evidence: [".agents/autonomy.config.json"],
      blockedReason: "task-source-command-missing"
    };
  }

  const result = spawnSync(command[0], command.slice(1), {
    cwd: projectRoot,
    encoding: "utf8",
    env: taskSourceCommandEnv(projectRoot, progress),
    shell: false,
    timeout: config.taskSources?.customCommand?.timeoutMs ?? 30_000
  });

  if (result.error) {
    return {
      task: null,
      warnings: [`Task source command failed: ${result.error.message}`],
      evidence: [".agents/autonomy.config.json"],
      blockedReason: "task-source-command-failed"
    };
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`;
    return {
      task: null,
      warnings: [`Task source command failed: ${detail}`],
      evidence: [".agents/autonomy.config.json"],
      blockedReason: "task-source-command-failed"
    };
  }

  try {
    return parseCustomCommandSelection(result.stdout);
  } catch (error) {
    return {
      task: null,
      warnings: [
        `Task source command returned invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      ],
      evidence: [".agents/autonomy.config.json"],
      blockedReason: "task-source-command-invalid"
    };
  }
}

export function readMarkdownRoadmapTasks(
  projectRoot: string,
  config: AutonomyConfig
): MarkdownTaskRow[] {
  const rows: MarkdownTaskRow[] = [];
  for (const relativePath of markdownRoadmapPaths(config)) {
    const roadmapPath = resolveRoadmapPath(projectRoot, relativePath);
    if (!fs.existsSync(roadmapPath.absolute)) {
      continue;
    }
    const realPath = fs.realpathSync(roadmapPath.absolute);
    ensureContainedPath(fs.realpathSync(projectRoot), realPath, relativePath);
    rows.push(
      ...parseMarkdownRoadmap(fs.readFileSync(realPath, "utf8"), roadmapPath.relative)
    );
  }
  return rows;
}

export function parseMarkdownRoadmap(markdown: string, sourcePath = "ROADMAP.md"): MarkdownTaskRow[] {
  const rows: MarkdownTaskRow[] = [];
  const lines = markdown.split("\n");
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*[-*]\s+\[\s\]\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    const parsed = parseMarkdownTaskText(match[1], sourcePath, index + 1);
    rows.push({ ...parsed, raw: line.trim() });
  }
  return rows;
}

function parseMarkdownTaskText(
  text: string,
  sourcePath: string,
  line: number
): Omit<MarkdownTaskRow, "raw"> {
  const bracketed = text.match(/^\[([A-Za-z0-9][A-Za-z0-9_.:-]*)\]\s+(.+)$/);
  if (bracketed) {
    return {
      id: bracketed[1],
      title: cleanMarkdownTaskTitle(bracketed[2].trim()),
      sourcePath,
      line
    };
  }

  const prefixed = text.match(/^([A-Za-z0-9][A-Za-z0-9_.:-]*)\s*[:\-]\s+(.+)$/);
  if (prefixed) {
    return {
      id: prefixed[1],
      title: cleanMarkdownTaskTitle(prefixed[2].trim()),
      sourcePath,
      line
    };
  }

  const fallbackId = `${path.basename(sourcePath, path.extname(sourcePath)).toUpperCase()}-${line}`;
  return {
    id: fallbackId,
    title: cleanMarkdownTaskTitle(text.trim()),
    sourcePath,
    line
  };
}

function stripMarkdown(value: string): string {
  return value.replace(/`([^`]+)`/g, "$1");
}

function cleanMarkdownTaskTitle(value: string): string {
  return stripMarkdown(value.replace(/`[^`]*\/[^`]*`/g, "").replace(/\((scope|paths?):[^)]*\)/gi, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function inferExpectedScope(location: string): string[] {
  const paths = [...location.matchAll(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+)/g)].map((match) =>
    match[1].replace(/\/$/, "")
  );
  if (paths.length > 0) {
    return paths;
  }
  return [];
}

export function knownTaskIds(projectRoot: string, config: AutonomyConfig): string[] | undefined {
  if (config.adapters.taskSource === "markdown-roadmap") {
    const tasks = readMarkdownRoadmapTasks(projectRoot, config);
    return tasks.map((task) => task.id);
  }
  return undefined;
}

function taskSourceCommandEnv(projectRoot: string, progress: ProgressState): NodeJS.ProcessEnv {
  const completed = [...new Set([...progress.completed, ...readGitCompletedTaskIds(projectRoot)])];
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    TMPDIR: process.env.TMPDIR ?? "",
    AGENT_AUTONOMY_PROGRESS: JSON.stringify({ ...progress, completed }),
    AGENT_AUTONOMY_GIT_COMPLETED_TASKS: JSON.stringify(completed)
  };
}

function readGitCompletedTaskIds(projectRoot: string): string[] {
  const fromMain = spawnSync("git", ["log", "--oneline", "-500", "origin/main"], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
    timeout: 5_000
  });
  const output =
    fromMain.status === 0
      ? fromMain.stdout
      : spawnSync("git", ["log", "--oneline", "-500", "HEAD"], {
          cwd: projectRoot,
          encoding: "utf8",
          shell: false,
          timeout: 5_000
        }).stdout;
  return [...new Set([...output.matchAll(/\bT\d{4}-\d+\b/g)].map((match) => match[0]))];
}

function parseCustomCommandSelection(stdout: string): TaskSelection {
  const parsed = JSON.parse(stdout) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("expected an object");
  }
  return {
    task: parseCustomCommandTask(parsed.task),
    warnings: readStringArray(parsed.warnings, "warnings"),
    evidence: readStringArray(parsed.evidence, "evidence"),
    blockedReason: typeof parsed.blockedReason === "string" ? parsed.blockedReason : undefined
  };
}

function parseCustomCommandTask(value: unknown): TaskBrief | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isRecord(value)) {
    throw new Error("task must be an object or null");
  }
  const expectedScope = readStringArray(value.expectedScope, "task.expectedScope");
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.deliverable !== "string"
  ) {
    throw new Error("task requires id, title, and deliverable strings");
  }
  return {
    id: value.id,
    title: value.title,
    deliverable: value.deliverable,
    expectedScope,
    highRisk: typeof value.highRisk === "boolean" ? value.highRisk : undefined
  };
}

function readStringArray(value: unknown, field: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${field} must be a string array`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextHighRisk(text: string, config: AutonomyConfig): boolean {
  const haystack = text.toLowerCase();
  for (const pattern of config.safety?.highRiskPatterns ?? []) {
    if (pattern.trim() && haystack.includes(pattern.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function markdownRoadmapPaths(config: AutonomyConfig): string[] {
  return config.taskSources?.markdownRoadmap?.paths?.length
    ? config.taskSources.markdownRoadmap.paths
    : ["ROADMAP.md", "docs/ROADMAP.md", "docs/roadmap.md", "TODO.md"];
}

function resolveRoadmapPath(projectRoot: string, configuredPath: string): { absolute: string; relative: string } {
  if (path.isAbsolute(configuredPath)) {
    throw new Error(`roadmap path must be relative: ${configuredPath}`);
  }
  const root = path.resolve(projectRoot);
  const absolute = path.resolve(root, configuredPath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`roadmap path escapes project root: ${configuredPath}`);
  }
  return { absolute, relative };
}

function ensureContainedPath(root: string, target: string, configuredPath: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`roadmap path escapes project root: ${configuredPath}`);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
