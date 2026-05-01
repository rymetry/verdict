import * as path from "node:path";
import {
  type CommandTemplate,
  type DetectedPackageManager,
  type SpecFile,
  type TestCase,
  type TestInventory
} from "@pwqa/shared";
import type { CommandRunner } from "../commands/runner.js";

export interface BuildInventoryRequest {
  projectId: string;
  projectRoot: string;
  packageManager: DetectedPackageManager;
  runner: CommandRunner;
  /** Optional override of the playwright list command (mainly for tests). */
  listCommand?: CommandTemplate;
  /** Maximum stdout/stderr to retain in warnings. */
  timeoutMs?: number;
}

/**
 * Per-project execution stub Playwright includes for every spec entry. Each
 * project (chromium, firefox, …) gets one of these. The shared spec metadata
 * (title, tags, line) lives one level up on `PlaywrightListJsonSpec`.
 */
interface PlaywrightListJsonProjectStub {
  projectId?: string;
  projectName?: string;
  expectedStatus?: string;
  status?: string;
  tags?: string[];
  results?: unknown[];
}

interface PlaywrightListJsonSpec {
  title: string;
  file?: string;
  line?: number;
  column?: number;
  id?: string;
  tags?: string[];
  ok?: boolean;
  tests?: PlaywrightListJsonProjectStub[];
}

interface PlaywrightListJsonSuite {
  title: string;
  file?: string;
  line?: number;
  column?: number;
  specs?: PlaywrightListJsonSpec[];
  suites?: PlaywrightListJsonSuite[];
}

interface PlaywrightListJsonRoot {
  config?: {
    rootDir?: string;
    configFile?: string;
  };
  suites?: PlaywrightListJsonSuite[];
  errors?: { message?: string }[];
}

function buildListCommand(packageManager: DetectedPackageManager): CommandTemplate {
  const base = packageManager.commandTemplates.playwrightTest;
  return {
    executable: base.executable,
    args: [...base.args, "--list", "--reporter=json"]
  };
}

function extractJsonBody(stdout: string): string | undefined {
  // Playwright sometimes prefixes the JSON with banner lines; locate the first '{'
  // at column 0 of a line and parse from there to end.
  const idx = stdout.indexOf("\n{");
  if (idx >= 0) {
    return stdout.slice(idx + 1);
  }
  if (stdout.startsWith("{")) return stdout;
  return undefined;
}

function resolveSpecFile(
  projectRoot: string,
  testRootDir: string | undefined,
  specFileFromJson: string
): { absolute: string; relative: string } {
  if (path.isAbsolute(specFileFromJson)) {
    return { absolute: specFileFromJson, relative: path.relative(projectRoot, specFileFromJson) };
  }
  // Playwright's --list reporter emits paths relative to `config.rootDir`
  // (typically the test directory). Resolve against rootDir when present;
  // fall back to projectRoot for configs that disable rootDir.
  const base = testRootDir ?? projectRoot;
  const absolute = path.resolve(base, specFileFromJson);
  return { absolute, relative: path.relative(projectRoot, absolute) };
}

function extractTags(
  spec: PlaywrightListJsonSpec,
  stub: PlaywrightListJsonProjectStub | undefined
): string[] {
  const tags = new Set<string>();
  for (const tag of spec.tags ?? []) tags.add(tag);
  for (const tag of stub?.tags ?? []) tags.add(tag);
  return Array.from(tags);
}

function flattenSuite(
  projectRoot: string,
  rootDir: string | undefined,
  suite: PlaywrightListJsonSuite,
  describePath: string[],
  emit: (specFile: string, test: TestCase) => void
): void {
  for (const spec of suite.specs ?? []) {
    const specFile = spec.file ?? suite.file;
    if (!specFile) continue;
    const { absolute, relative } = resolveSpecFile(projectRoot, rootDir, specFile);
    const stub = spec.tests?.[0];
    const id = spec.id ?? `${relative}:${spec.line ?? 0}:${spec.title}`;
    const fullTitle = [...describePath, spec.title].join(" > ");
    const testCase: TestCase = {
      id,
      title: spec.title,
      fullTitle,
      filePath: absolute,
      relativePath: relative,
      line: spec.line ?? 1,
      column: spec.column ?? 0,
      describePath: [...describePath],
      tags: extractTags(spec, stub),
      projectName: stub?.projectName || undefined,
      qaMetadata: {
        purpose: fullTitle,
        steps: [],
        expectations: [],
        source: "playwright-list-json",
        confidence: "low"
      }
    };
    emit(relative, testCase);
  }
  for (const child of suite.suites ?? []) {
    const nextDescribe = child.title ? [...describePath, child.title] : describePath;
    flattenSuite(projectRoot, rootDir, child, nextDescribe, emit);
  }
}

export function parsePlaywrightListJson(
  projectRoot: string,
  rawJson: string
): { specs: SpecFile[]; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  let parsed: PlaywrightListJsonRoot;
  try {
    parsed = JSON.parse(rawJson) as PlaywrightListJsonRoot;
  } catch (error) {
    return {
      specs: [],
      warnings,
      errors: [
        `Failed to parse Playwright --list JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      ]
    };
  }
  for (const err of parsed.errors ?? []) {
    if (err.message) errors.push(err.message);
  }

  const rootDir = parsed.config?.rootDir;
  const grouped = new Map<string, TestCase[]>();
  for (const suite of parsed.suites ?? []) {
    flattenSuite(projectRoot, rootDir, suite, [], (specFile, testCase) => {
      const list = grouped.get(specFile) ?? [];
      list.push(testCase);
      grouped.set(specFile, list);
    });
  }

  const specs: SpecFile[] = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([relativeSpec, tests]) => ({
      filePath: path.isAbsolute(relativeSpec)
        ? relativeSpec
        : path.join(projectRoot, relativeSpec),
      relativePath: relativeSpec,
      tests
    }));

  return { specs, warnings, errors };
}

export async function buildInventory(
  request: BuildInventoryRequest
): Promise<TestInventory> {
  const generatedAt = new Date().toISOString();
  if (request.packageManager.blockingExecution) {
    return {
      projectId: request.projectId,
      source: "unavailable",
      generatedAt,
      specs: [],
      totals: { specFiles: 0, tests: 0 },
      warnings: [...request.packageManager.warnings],
      error: [
        ...request.packageManager.errors,
        "Test inventory cannot be retrieved while project execution is blocked."
      ].join(" ")
    };
  }

  const command = request.listCommand ?? buildListCommand(request.packageManager);
  const handle = request.runner.run(
    {
      executable: command.executable,
      args: command.args,
      cwd: request.projectRoot,
      timeoutMs: request.timeoutMs ?? 60_000,
      label: "playwright --list"
    },
    {}
  );
  const result = await handle.result;

  if (result.exitCode !== 0) {
    return {
      projectId: request.projectId,
      source: "unavailable",
      generatedAt,
      specs: [],
      totals: { specFiles: 0, tests: 0 },
      warnings: [],
      error:
        `Playwright --list exited with code ${result.exitCode ?? "unknown"}.` +
        (result.stderr.trim() ? ` ${result.stderr.trim().slice(0, 500)}` : "")
    };
  }

  const jsonBody = extractJsonBody(result.stdout) ?? result.stdout;
  const { specs, warnings, errors } = parsePlaywrightListJson(request.projectRoot, jsonBody);
  return {
    projectId: request.projectId,
    source: "playwright-list-json",
    generatedAt,
    specs,
    totals: {
      specFiles: specs.length,
      tests: specs.reduce((acc, spec) => acc + spec.tests.length, 0)
    },
    warnings,
    error: errors.length > 0 ? errors.join(" ") : undefined
  };
}
