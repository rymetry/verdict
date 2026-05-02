import * as os from "node:os";
import {
  AiWorkbenchContextSchema,
  type AiWorkbenchContext,
  type WorkbenchContext,
  type WorkbenchHookSpec,
  type WorkbenchPrompt,
  type WorkbenchRule,
  type WorkbenchSkill
} from "@pwqa/shared";
import { redactWithStats } from "../commands/redact.js";
import { loadWorkbench } from "../workbench/index.js";

const MAX_CONTEXT_TEXT_LENGTH = 12 * 1024;

const LOCAL_PATH_PATTERNS: ReadonlyArray<{ regex: RegExp; replacement: string }> = [
  {
    regex:
      /(^|[\s"'(=<>])\/(?:Users|home|tmp|private|var|etc|root|opt|mnt|Volumes|srv|usr|bin|sbin|lib|System|Applications)\/[^\s"'<>)]*/g,
    replacement: "$1<REDACTED_PATH>"
  },
  {
    regex:
      /\/(?:Users|home|tmp|private|var|etc|root|opt|mnt|Volumes|srv|usr|bin|sbin|lib|System|Applications)\/[^\s"'<>)]*/g,
    replacement: "<REDACTED_PATH>"
  },
  { regex: /[A-Za-z]:\\[^\s"'<>)]*/g, replacement: "<REDACTED_PATH>" },
  { regex: /\\\\[A-Za-z0-9._$-]+\\[^\s"'<>)]*/g, replacement: "<REDACTED_PATH>" },
  { regex: /\\(?:Users|home|tmp|private|var|etc|root|opt|mnt|Volumes|srv|usr)\\[^\s"'<>)]*/g, replacement: "<REDACTED_PATH>" }
];

export interface BuildAiWorkbenchContextInput {
  projectRoot: string;
}

export interface BuildAiWorkbenchContextResult {
  context: AiWorkbenchContext;
  warnings: readonly string[];
}

export async function buildAiWorkbenchContext(
  input: BuildAiWorkbenchContextInput
): Promise<BuildAiWorkbenchContextResult> {
  let workbench: WorkbenchContext;
  try {
    workbench = await loadWorkbench(input.projectRoot);
  } catch (error) {
    const warning = sanitizeText(
      `Workbench context unavailable: ${errorMessage(error)}`,
      input.projectRoot,
      ".workbench",
      []
    );
    return {
      context: emptyWorkbenchContext([warning]),
      warnings: [warning]
    };
  }
  return toAiWorkbenchContext(workbench, input.projectRoot);
}

function toAiWorkbenchContext(
  workbench: WorkbenchContext,
  projectRoot: string
): BuildAiWorkbenchContextResult {
  const warnings: string[] = [];
  const sanitize = (value: string, relativePath: string): string =>
    sanitizeText(value, projectRoot, relativePath, warnings);

  const context = AiWorkbenchContextSchema.parse({
    agents: workbench.agents
      ? {
          relativePath: workbench.agents.relativePath,
          content: sanitize(workbench.agents.content, workbench.agents.relativePath)
        }
      : undefined,
    rules: workbench.rules.map((rule) => sanitizeDocument(rule, sanitize)),
    skills: workbench.skills.map((skill) => sanitizeDocument(skill, sanitize)),
    hooks: workbench.hooks.map((hook) => sanitizeHook(hook, sanitize)),
    prompts: workbench.prompts.map((prompt) => sanitizeDocument(prompt, sanitize)),
    warnings
  });

  return { context, warnings };
}

function sanitizeDocument(
  document: WorkbenchRule | WorkbenchSkill | WorkbenchPrompt,
  sanitize: (value: string, relativePath: string) => string
): AiWorkbenchContext["rules"][number] {
  return {
    name: document.name,
    relativePath: document.relativePath,
    frontmatter: sanitizeJsonValue(document.frontmatter, (value) =>
      sanitize(value, document.relativePath)
    ) as Record<string, unknown>,
    content: sanitize(document.content, document.relativePath)
  };
}

function sanitizeHook(
  hook: WorkbenchHookSpec,
  sanitize: (value: string, relativePath: string) => string
): AiWorkbenchContext["hooks"][number] {
  return {
    name: hook.name,
    relativePath: hook.relativePath,
    extension: hook.extension,
    content: sanitize(hook.content, hook.relativePath)
  };
}

function sanitizeJsonValue(value: unknown, sanitize: (value: string) => string): unknown {
  if (typeof value === "string") return sanitize(value);
  if (Array.isArray(value)) return value.map((entry) => sanitizeJsonValue(entry, sanitize));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        sanitize(key),
        sanitizeJsonValue(nested, sanitize)
      ])
    );
  }
  return value;
}

function sanitizeText(
  value: string,
  projectRoot: string,
  relativePath: string,
  warnings: string[]
): string {
  const normalized = sanitizePathText(value, projectRoot);
  const redacted = redactWithStats(normalized);
  if (redacted.replacements > 0) {
    warnings.push(
      `${relativePath}: redacted ${redacted.replacements} secret-like value(s) before AI context injection.`
    );
  }
  if (redacted.value.length <= MAX_CONTEXT_TEXT_LENGTH) return redacted.value;
  warnings.push(
    `${relativePath}: truncated to ${MAX_CONTEXT_TEXT_LENGTH} trailing characters before AI context injection.`
  );
  return redacted.value.slice(redacted.value.length - MAX_CONTEXT_TEXT_LENGTH);
}

function sanitizePathText(value: string, projectRoot: string): string {
  let output = value
    .split(projectRoot)
    .join("<projectRoot>")
    .split(os.homedir())
    .join("<home>");
  for (const { regex, replacement } of LOCAL_PATH_PATTERNS) {
    output = output.replace(regex, replacement);
  }
  return output;
}

function emptyWorkbenchContext(warnings: readonly string[]): AiWorkbenchContext {
  return AiWorkbenchContextSchema.parse({
    rules: [],
    skills: [],
    hooks: [],
    prompts: [],
    warnings
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
