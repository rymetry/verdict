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

interface PlaywrightListJsonSpec {
  file: string;
  tests: PlaywrightListJsonTest[];
}

interface PlaywrightListJsonSuite {
  title: string;
  file?: string;
  line?: number;
  column?: number;
  specs?: PlaywrightListJsonSpec[];
  suites?: PlaywrightListJsonSuite[];
}

interface PlaywrightListJsonTestEntry {
  id?: string;
  projectName?: string;
  tags?: string[];
}

interface PlaywrightListJsonTest {
  title: string;
  id?: string;
  line?: number;
  column?: number;
  tags?: string[];
  results?: unknown[];
  tests?: PlaywrightListJsonTestEntry[];
}

interface PlaywrightListJsonRoot {
  config?: {
    rootDir?: string;
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

function findFirstJsonObject(stdout: string): string | undefined {
  // Playwright sometimes prefixes the JSON with banner lines; locate the first '{'
  // at column 0 of a line and parse from there to end.
  const idx = stdout.indexOf("\n{");
  if (idx >= 0) {
    return stdout.slice(idx + 1);
  }
  if (stdout.startsWith("{")) return stdout;
  return undefined;
}

function relativePath(projectRoot: string, absolutePath: string): string {
  const relative = path.relative(projectRoot, absolutePath);
  return relative === "" ? path.basename(absolutePath) : relative;
}

function extractTags(spec: PlaywrightListJsonSpec, test: PlaywrightListJsonTest): string[] {
  const tags = new Set<string>();
  for (const tag of test.tags ?? []) tags.add(tag);
  for (const entry of test.tests ?? []) {
    for (const tag of entry.tags ?? []) tags.add(tag);
  }
  return Array.from(tags);
}

function flattenSuite(
  projectRoot: string,
  suite: PlaywrightListJsonSuite,
  describePath: string[],
  fileFromAncestor: string | undefined,
  emit: (specFile: string, test: TestCase) => void
): void {
  const file = suite.file ?? fileFromAncestor;
  for (const spec of suite.specs ?? []) {
    const specFile = spec.file ?? file;
    if (!specFile) continue;
    const absoluteSpec = path.isAbsolute(specFile) ? specFile : path.join(projectRoot, specFile);
    const relSpec = relativePath(projectRoot, absoluteSpec);
    for (const test of spec.tests) {
      const projectEntry = test.tests?.[0];
      const id = test.id ?? projectEntry?.id ?? `${relSpec}:${test.line ?? 0}:${test.title}`;
      const testCase: TestCase = {
        id,
        title: test.title,
        filePath: absoluteSpec,
        relativePath: relSpec,
        line: test.line ?? 1,
        column: test.column ?? 0,
        describePath: [...describePath],
        tags: extractTags(spec, test),
        projectName: projectEntry?.projectName
      };
      emit(relSpec, testCase);
    }
  }
  for (const child of suite.suites ?? []) {
    const nextDescribe = child.title ? [...describePath, child.title] : describePath;
    flattenSuite(projectRoot, child, nextDescribe, file, emit);
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

  const grouped = new Map<string, TestCase[]>();
  for (const suite of parsed.suites ?? []) {
    flattenSuite(projectRoot, suite, [], suite.file, (specFile, testCase) => {
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

  const jsonBody = findFirstJsonObject(result.stdout) ?? result.stdout;
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
