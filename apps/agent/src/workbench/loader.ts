import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  WorkbenchAgentsManifestSchema,
  WorkbenchConfigSchema,
  WorkbenchContextSchema,
  WorkbenchHookSpecSchema,
  WorkbenchIntentSchema,
  WorkbenchPromptSchema,
  WorkbenchRuleSchema,
  WorkbenchSkillSchema,
  type WorkbenchContext,
  type WorkbenchFrontmatter
} from "@pwqa/shared";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

type FileEntry = {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly name: string;
};

const WORKBENCH_DIR = ".workbench";
const MARKDOWN_EXTENSION = ".md";
const YAML_EXTENSION = ".yaml";
const HOOK_EXTENSIONS = new Set([".sh", ".toml", ".json"]);

export async function loadWorkbench(projectRoot: string): Promise<WorkbenchContext> {
  const absoluteProjectRoot = await resolveProjectRoot(projectRoot);
  const workbenchRoot = path.join(absoluteProjectRoot, WORKBENCH_DIR);

  if (!(await directoryExists(workbenchRoot))) {
    return freezeWorkbenchContext(
      WorkbenchContextSchema.parse({
        skills: [],
        rules: [],
        hooks: [],
        intents: [],
        prompts: []
      })
    );
  }

  const agents = await loadAgentsManifest(workbenchRoot, absoluteProjectRoot);
  const [config, skills, rules, hooks, intents, prompts] = await Promise.all([
    loadConfig(workbenchRoot, absoluteProjectRoot),
    loadSkills(workbenchRoot, absoluteProjectRoot),
    loadRules(workbenchRoot, absoluteProjectRoot),
    loadHooks(workbenchRoot, absoluteProjectRoot),
    loadIntents(workbenchRoot, absoluteProjectRoot),
    loadPrompts(workbenchRoot, absoluteProjectRoot)
  ]);

  return freezeWorkbenchContext(
    WorkbenchContextSchema.parse({
      config,
      agents,
      skills,
      rules,
      hooks,
      intents,
      prompts
    })
  );
}

async function loadConfig(
  workbenchRoot: string,
  projectRoot: string
): Promise<WorkbenchContext["config"]> {
  const absolutePath = path.join(workbenchRoot, "workbench.json");
  if (!(await fileExists(absolutePath))) {
    return undefined;
  }

  const relativePath = projectRelativePath(absolutePath, projectRoot);
  return parseFile(relativePath, async () =>
    WorkbenchConfigSchema.parse(JSON.parse(await fs.readFile(absolutePath, "utf8")))
  );
}

async function loadAgentsManifest(
  workbenchRoot: string,
  projectRoot: string
): Promise<WorkbenchContext["agents"]> {
  const absolutePath = path.join(workbenchRoot, "AGENTS.md");
  if (!(await fileExists(absolutePath))) {
    return undefined;
  }

  const relativePath = projectRelativePath(absolutePath, projectRoot);
  return parseFile(relativePath, async () =>
    WorkbenchAgentsManifestSchema.parse({
      relativePath,
      content: await fs.readFile(absolutePath, "utf8")
    })
  );
}

async function loadSkills(workbenchRoot: string, projectRoot: string): Promise<WorkbenchContext["skills"]> {
  const skillsRoot = path.join(workbenchRoot, "skills");
  const entries = await listSkillEntries(skillsRoot, projectRoot);
  return Promise.all(
    entries.map(async (entry) =>
      parseFile(entry.relativePath, async () => {
        const parsed = parseMarkdownWithFrontmatter(
          await fs.readFile(entry.absolutePath, "utf8"),
          entry.relativePath
        );
        return WorkbenchSkillSchema.parse({
          name: entry.name,
          relativePath: entry.relativePath,
          frontmatter: parsed.frontmatter,
          content: parsed.content
        });
      })
    )
  );
}

async function loadRules(workbenchRoot: string, projectRoot: string): Promise<WorkbenchContext["rules"]> {
  const entries = await listFlatFiles(path.join(workbenchRoot, "rules"), projectRoot, MARKDOWN_EXTENSION);
  return Promise.all(
    entries.map(async (entry) =>
      parseFile(entry.relativePath, async () => {
        const parsed = parseMarkdownWithFrontmatter(
          await fs.readFile(entry.absolutePath, "utf8"),
          entry.relativePath
        );
        return WorkbenchRuleSchema.parse({
          name: entry.name,
          relativePath: entry.relativePath,
          frontmatter: parsed.frontmatter,
          content: parsed.content
        });
      })
    )
  );
}

async function loadHooks(workbenchRoot: string, projectRoot: string): Promise<WorkbenchContext["hooks"]> {
  const hooksRoot = path.join(workbenchRoot, "hooks");
  if (!(await directoryExists(hooksRoot))) {
    return [];
  }

  const dirents = await fs.readdir(hooksRoot, { withFileTypes: true });
  const entries = dirents
    .filter((dirent) => dirent.isFile())
    .filter((dirent) => !isBackupName(dirent.name))
    .filter((dirent) => HOOK_EXTENSIONS.has(path.extname(dirent.name)))
    .map((dirent) => fileEntry(hooksRoot, projectRoot, dirent.name))
    .sort(compareFileEntries);

  return Promise.all(
    entries.map(async (entry) =>
      parseFile(entry.relativePath, async () =>
        WorkbenchHookSpecSchema.parse({
          name: entry.name,
          relativePath: entry.relativePath,
          extension: path.extname(entry.absolutePath).slice(1),
          content: await fs.readFile(entry.absolutePath, "utf8")
        })
      )
    )
  );
}

async function loadIntents(workbenchRoot: string, projectRoot: string): Promise<WorkbenchContext["intents"]> {
  const entries = await listFlatFiles(path.join(workbenchRoot, "intents"), projectRoot, YAML_EXTENSION);
  return Promise.all(
    entries.map(async (entry) =>
      parseFile(entry.relativePath, async () => {
        const content = await fs.readFile(entry.absolutePath, "utf8");
        return WorkbenchIntentSchema.parse({
          name: entry.name,
          relativePath: entry.relativePath,
          data: parseSimpleYamlObject(content, entry.relativePath),
          content
        });
      })
    )
  );
}

async function loadPrompts(workbenchRoot: string, projectRoot: string): Promise<WorkbenchContext["prompts"]> {
  const entries = await listFlatFiles(path.join(workbenchRoot, "prompts"), projectRoot, MARKDOWN_EXTENSION);
  return Promise.all(
    entries.map(async (entry) =>
      parseFile(entry.relativePath, async () => {
        const parsed = parseMarkdownWithFrontmatter(
          await fs.readFile(entry.absolutePath, "utf8"),
          entry.relativePath
        );
        return WorkbenchPromptSchema.parse({
          name: entry.name,
          relativePath: entry.relativePath,
          frontmatter: parsed.frontmatter,
          content: parsed.content
        });
      })
    )
  );
}

async function listSkillEntries(skillsRoot: string, projectRoot: string): Promise<readonly FileEntry[]> {
  if (!(await directoryExists(skillsRoot))) {
    return [];
  }

  const dirents = await fs.readdir(skillsRoot, { withFileTypes: true });
  const entries = dirents
    .filter((dirent) => dirent.isDirectory())
    .filter((dirent) => !isBackupName(dirent.name))
    .map((dirent) => {
      const skillPath = path.join(skillsRoot, dirent.name, "SKILL.md");
      return {
        absolutePath: skillPath,
        relativePath: projectRelativePath(skillPath, projectRoot),
        name: dirent.name
      };
    })
    .sort(compareFileEntries)
    .filter((entry) => !isBackupRelativePath(entry.relativePath));

  const existingEntries = await Promise.all(
    entries.map(async (entry) => ((await fileExists(entry.absolutePath)) ? entry : undefined))
  );
  return existingEntries.filter((entry): entry is FileEntry => entry !== undefined);
}

async function listFlatFiles(
  directory: string,
  projectRoot: string,
  extension: string
): Promise<readonly FileEntry[]> {
  if (!(await directoryExists(directory))) {
    return [];
  }

  const dirents = await fs.readdir(directory, { withFileTypes: true });
  return dirents
    .filter((dirent) => dirent.isFile())
    .filter((dirent) => !isBackupName(dirent.name))
    .filter((dirent) => path.extname(dirent.name) === extension)
    .map((dirent) => fileEntry(directory, projectRoot, dirent.name))
    .sort(compareFileEntries);
}

function fileEntry(directory: string, projectRoot: string, fileName: string): FileEntry {
  const absolutePath = path.join(directory, fileName);
  return {
    absolutePath,
    relativePath: projectRelativePath(absolutePath, projectRoot),
    name: path.basename(fileName, path.extname(fileName))
  };
}

function parseMarkdownWithFrontmatter(
  raw: string,
  relativePath: string
): { readonly frontmatter: WorkbenchFrontmatter; readonly content: string } {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { frontmatter: {}, content: raw };
  }

  const lines = raw.split(/\r?\n/);
  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex === -1) {
    throw new Error(`Invalid frontmatter in ${relativePath}: missing closing delimiter`);
  }

  return {
    frontmatter: parseSimpleYamlObject(lines.slice(1, closingIndex).join("\n"), relativePath),
    content: lines.slice(closingIndex + 1).join("\n")
  };
}

function parseSimpleYamlObject(raw: string, relativePath: string): Record<string, unknown> {
  try {
    const parsed = parseYaml(raw);
    if (parsed === null) {
      return {};
    }
    return z.record(z.string(), z.unknown()).parse(parsed);
  } catch (error) {
    const suffix = error instanceof z.ZodError ? "expected a YAML mapping object" : errorName(error);
    throw new Error(`Invalid YAML in ${relativePath}: ${suffix}`);
  }
}

async function parseFile<T>(relativePath: string, parse: () => Promise<T>): Promise<T> {
  try {
    return await parse();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.issues.map((issue) => issue.message).join("; ");
      throw new Error(`Failed to load ${relativePath}: ${messages}`);
    }
    if (error instanceof Error && error.message.includes(relativePath)) {
      throw error;
    }
    throw new Error(`Failed to load ${relativePath}: ${errorName(error)}`);
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "Unknown error";
}

async function directoryExists(target: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(target: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(target);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function resolveProjectRoot(projectRoot: string): Promise<string> {
  try {
    return await fs.realpath(projectRoot);
  } catch {
    throw new Error("Failed to load .workbench: project root is not readable");
  }
}

function projectRelativePath(absolutePath: string, projectRoot: string): string {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

function isBackupName(name: string): boolean {
  return (
    name.endsWith(".backup") ||
    name.endsWith(".orig") ||
    name.endsWith(".bak") ||
    name.endsWith("~") ||
    /\.pre-[^/\\]+$/.test(name)
  );
}

function isBackupRelativePath(relativePath: string): boolean {
  return relativePath.split("/").some(isBackupName);
}

function compareFileEntries(left: FileEntry, right: FileEntry): number {
  return left.relativePath.localeCompare(right.relativePath);
}

function freezeWorkbenchContext(context: WorkbenchContext): WorkbenchContext {
  return deepFreeze(context);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
