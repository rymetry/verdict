import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  AuthSetupRisk,
  ConfigReporter,
  ConfigUseOption,
  FixtureEntry,
  FixtureSignal,
  ProjectConfigSummary
} from "@pwqa/shared";

export interface BuildConfigSummaryRequest {
  projectId: string;
  projectRoot: string;
  configPath?: string;
}

const CONFIG_TEXT_SIZE_CAP_BYTES = 1024 * 1024;
const SOURCE_FILE_SIZE_CAP_BYTES = 200 * 1024;
const MAX_DIRECTORY_ENTRIES = 1_000;
const MAX_SOURCE_FILES = 500;
const MAX_FIXTURE_FILES = 100;

const SKIPPED_DIRECTORIES = new Set([
  ".git", ".playwright-workbench", "allure-report", "allure-results", "coverage",
  "dist", "node_modules", "playwright-report", "test-results"
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const KNOWN_REPORTERS = [
  "list", "json", "html", "line", "dot", "github", "blob", "junit", "allure-playwright"
] as const;

const BLOCK_COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_PATTERN = /\/\/.*$/gm;
const AUTH_SETUP_FILE_PATTERN = /(^|[./_-])(auth|login|global|setup)[._-]?(setup|auth|login)?\.(?:ts|tsx|js|jsx|mjs|cjs)$/i;

function stripJsComments(text: string): string {
  return text.replace(BLOCK_COMMENT_PATTERN, "").replace(LINE_COMMENT_PATTERN, "");
}

function relativeToProject(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).split(path.sep).join("/");
}

function configFormat(configPath: string | undefined): ProjectConfigSummary["config"]["format"] {
  const ext = path.extname(configPath ?? "").replace(".", "");
  if (ext === "ts" || ext === "js" || ext === "mjs" || ext === "cjs") return ext;
  return "unknown";
}

async function readConfigText(
  configPath: string | undefined
): Promise<{ text?: string; sizeBytes?: number; warnings: string[] }> {
  if (!configPath) {
    return { warnings: ["playwright.config.{ts,js,mjs,cjs} was not found."] };
  }
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(configPath);
  } catch (error) {
    return {
      warnings: [
        `playwright.config could not be inspected. code=${readErrnoCode(error)}`
      ]
    };
  }
  if (stat.size > CONFIG_TEXT_SIZE_CAP_BYTES) {
    return {
      sizeBytes: stat.size,
      warnings: [
        `playwright.config exceeds the config summary size cap (${CONFIG_TEXT_SIZE_CAP_BYTES} bytes).`
      ]
    };
  }
  try {
    return {
      text: await fs.readFile(configPath, "utf8"),
      sizeBytes: stat.size,
      warnings: []
    };
  } catch (error) {
    return {
      sizeBytes: stat.size,
      warnings: [
        `playwright.config could not be read. code=${readErrnoCode(error)}`
      ]
    };
  }
}

function readErrnoCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "READ_FAILED";
}

function extractReporters(configText: string | undefined): ConfigReporter[] {
  if (!configText) return [];
  const stripped = stripJsComments(configText);
  return KNOWN_REPORTERS
    .filter((name) => new RegExp(`['"]${escapeRegex(name)}['"]`).test(stripped))
    .map((name) => ({ name, source: "heuristic" }));
}

function extractUseOptions(configText: string | undefined): ConfigUseOption[] {
  if (!configText) return [];
  const stripped = stripJsComments(configText);
  const options: ConfigUseOption[] = [];
  for (const name of ["trace", "screenshot", "video"] as const) {
    const match = new RegExp(`\\b${name}\\s*:\\s*(['"][^'"]+['"]|true|false)`).exec(stripped);
    if (match?.[1]) {
      options.push({
        name,
        value: match[1].replace(/^['"]|['"]$/g, ""),
        source: "heuristic"
      });
    }
  }
  return options;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isUnsafeProjectRelativePath(value: string): boolean {
  if (value.startsWith("-") || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    return true;
  }
  return value.split(/[\\/]+/).includes("..");
}

function riskPath(value: string): string | undefined {
  return isUnsafeProjectRelativePath(value) ? undefined : value.split(/[\\/]+/).join("/");
}

function extractConfigAuthRisks(
  configText: string | undefined,
  configRelativePath: string | undefined
): AuthSetupRisk[] {
  if (!configText) return [];
  const stripped = stripJsComments(configText);
  const risks: AuthSetupRisk[] = [];

  for (const match of stripped.matchAll(/\bstorageState\s*:\s*(['"])([^'"]+)\1/g)) {
    const value = match[2]!;
    const relativePath = riskPath(value);
    risks.push({
      signal: "storage-state-path",
      severity: relativePath ? "warning" : "high",
      message: relativePath
        ? "storageState file path is configured; cookie/localStorage contents are intentionally not read."
        : "storageState path is absolute or escapes the project boundary.",
      relativePath,
      source: "heuristic"
    });
  }

  if (/\bstorageState\s*:\s*\{/.test(stripped)) {
    risks.push({
      signal: "storage-state-inline",
      severity: "high",
      message: "Inline storageState object detected; avoid committing cookies or localStorage values.",
      relativePath: configRelativePath,
      source: "heuristic"
    });
  }

  for (const match of stripped.matchAll(/\bglobalSetup\s*:\s*(['"])([^'"]+)\1/g)) {
    const value = match[2]!;
    const relativePath = riskPath(value);
    risks.push({
      signal: "global-setup",
      severity: "info",
      message: "globalSetup is configured; auth setup side effects should be documented.",
      relativePath: relativePath ?? configRelativePath,
      source: "heuristic"
    });
  }

  return risks;
}

async function scanFixtureFiles(projectRoot: string): Promise<{
  fixtureFiles: FixtureEntry[];
  warnings: string[];
}> {
  const fixtureFiles: FixtureEntry[] = [];
  const warnings: string[] = [];
  let directoriesVisited = 0;
  let sourceFilesVisited = 0;
  let stopped = false;

  async function visit(directory: string): Promise<void> {
    if (stopped) return;
    directoriesVisited += 1;
    if (directoriesVisited > MAX_DIRECTORY_ENTRIES) {
      warnings.push(`fixture scan stopped after ${MAX_DIRECTORY_ENTRIES} directories.`);
      stopped = true;
      return;
    }

    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      warnings.push(`fixture scan skipped unreadable directory ${relativeToProject(projectRoot, directory)}. code=${readErrnoCode(error)}`);
      return;
    }

    for (const entry of entries) {
      if (stopped) return;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await visit(absolute);
        }
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      sourceFilesVisited += 1;
      if (sourceFilesVisited > MAX_SOURCE_FILES) {
        warnings.push(`fixture scan stopped after ${MAX_SOURCE_FILES} source files.`);
        stopped = true;
        return;
      }

      const fixture = await inspectFixtureCandidate(projectRoot, absolute);
      if (fixture) {
        fixtureFiles.push(fixture);
        if (fixtureFiles.length >= MAX_FIXTURE_FILES) {
          warnings.push(`fixture scan stopped after ${MAX_FIXTURE_FILES} fixture-like files.`);
          stopped = true;
          return;
        }
      }
    }
  }

  await visit(projectRoot);
  fixtureFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { fixtureFiles, warnings };
}

async function scanAuthSetupRisks(projectRoot: string): Promise<{
  authRisks: AuthSetupRisk[];
  warnings: string[];
}> {
  const authRisks: AuthSetupRisk[] = [];
  const warnings: string[] = [];
  let directoriesVisited = 0;
  let sourceFilesVisited = 0;
  let stopped = false;

  async function visit(directory: string): Promise<void> {
    if (stopped) return;
    directoriesVisited += 1;
    if (directoriesVisited > MAX_DIRECTORY_ENTRIES) {
      warnings.push(`auth setup scan stopped after ${MAX_DIRECTORY_ENTRIES} directories.`);
      stopped = true;
      return;
    }

    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      warnings.push(`auth setup scan skipped unreadable directory ${relativeToProject(projectRoot, directory)}. code=${readErrnoCode(error)}`);
      return;
    }

    for (const entry of entries) {
      if (stopped) return;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await visit(absolute);
        }
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      sourceFilesVisited += 1;
      if (sourceFilesVisited > MAX_SOURCE_FILES) {
        warnings.push(`auth setup scan stopped after ${MAX_SOURCE_FILES} source files.`);
        stopped = true;
        return;
      }

      const risk = await inspectAuthSetupCandidate(projectRoot, absolute);
      if (risk) {
        authRisks.push(risk);
      }
    }
  }

  await visit(projectRoot);
  authRisks.sort((a, b) => (a.relativePath ?? "").localeCompare(b.relativePath ?? ""));
  return { authRisks, warnings };
}

async function inspectFixtureCandidate(
  projectRoot: string,
  absolutePath: string
): Promise<FixtureEntry | undefined> {
  const stat = await fs.stat(absolutePath);
  const relativePath = relativeToProject(projectRoot, absolutePath);
  const lowerRelative = relativePath.toLowerCase();
  const signals: FixtureSignal[] = [];
  if (lowerRelative.split("/").includes("fixtures") || lowerRelative.includes("fixture.")) {
    signals.push("fixture-path");
  }

  if (stat.size <= SOURCE_FILE_SIZE_CAP_BYTES) {
    const text = await fs.readFile(absolutePath, "utf8");
    if (/\b(?:test|base)\.extend\s*(?:<[^>]+>)?\(/.test(stripJsComments(text))) {
      signals.push("test-extend");
    }
  }

  if (signals.length === 0) return undefined;
  return {
    relativePath,
    kind: signals.includes("fixture-path") ? "fixture-file" : "test-extend",
    signals,
    sizeBytes: stat.size
  };
}

async function inspectAuthSetupCandidate(
  projectRoot: string,
  absolutePath: string
): Promise<AuthSetupRisk | undefined> {
  const stat = await fs.stat(absolutePath);
  if (stat.size > SOURCE_FILE_SIZE_CAP_BYTES) return undefined;

  const relativePath = relativeToProject(projectRoot, absolutePath);
  if (path.basename(relativePath).startsWith("playwright.config.")) {
    return undefined;
  }
  const lowerRelative = relativePath.toLowerCase();
  const basename = path.basename(relativePath);
  const looksLikeAuthSetup =
    AUTH_SETUP_FILE_PATTERN.test(basename) ||
    (lowerRelative.split("/").some((part) => part.includes("auth")) &&
      basename.toLowerCase().includes("setup"));

  const text = stripJsComments(await fs.readFile(absolutePath, "utf8"));
  if (!looksLikeAuthSetup && !/\bstorageState\b/.test(text)) {
    return undefined;
  }

  return {
    signal: "auth-setup-file",
    severity: /\bstorageState\b/.test(text) ? "warning" : "info",
    message: "Auth setup-like source file detected; review storageState handling and secret hygiene.",
    relativePath,
    source: "heuristic"
  };
}

export async function buildConfigSummary(
  request: BuildConfigSummaryRequest
): Promise<ProjectConfigSummary> {
  const generatedAt = new Date().toISOString();
  const configRead = await readConfigText(request.configPath);
  const fixtureScan = await scanFixtureFiles(request.projectRoot);
  const authSetupScan = await scanAuthSetupRisks(request.projectRoot);
  const config = {
    path: request.configPath,
    relativePath: request.configPath
      ? relativeToProject(request.projectRoot, request.configPath)
      : undefined,
    format: configFormat(request.configPath),
    sizeBytes: configRead.sizeBytes
  };

  return {
    projectId: request.projectId,
    generatedAt,
    config,
    reporters: extractReporters(configRead.text),
    useOptions: extractUseOptions(configRead.text),
    fixtureFiles: fixtureScan.fixtureFiles,
    authRisks: [
      ...extractConfigAuthRisks(configRead.text, config.relativePath),
      ...authSetupScan.authRisks
    ],
    warnings: [...configRead.warnings, ...fixtureScan.warnings, ...authSetupScan.warnings]
  };
}
