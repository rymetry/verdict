import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  type CommandTemplate,
  type DetectedPackageManager,
  type SpecFile,
  type TestCodeSignal,
  type TestCase,
  type TestStep,
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

const STATIC_ANALYSIS_FILE_SIZE_CAP_BYTES = 256 * 1024;
const LOCATOR_CALL_PATTERN =
  /\b(?:page|locator|[\w.]+)\.(getByRole|getByText|getByLabel|getByTestId|getByPlaceholder|getByAltText|getByTitle|locator)\s*\(/g;
const TEST_STEP_PATTERN = /\btest\.step\s*\(\s*(['"`])([^'"`]+)\1/g;
const ALLURE_STEP_PATTERN = /\ballure\.step\s*\(\s*(['"`])([^'"`]+)\1/g;
const ALLURE_METADATA_PATTERN =
  /\ballure\.(epic|feature|story|suite|parentSuite|subSuite|severity|owner|tag|label|link|issue|tms)\s*\(/g;

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

function isInsideProject(projectRoot: string, absolutePath: string): boolean {
  const relative = path.relative(projectRoot, absolutePath);
  return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function compactSourceLine(line: string): string {
  return line.trim().replace(/\s+/g, " ").slice(0, 240);
}

function pushUniqueStep(target: TestStep[], step: TestStep): void {
  if (target.some((existing) => existing.title === step.title && existing.line === step.line)) {
    return;
  }
  target.push(step);
}

function pushUniqueSignal(target: TestCodeSignal[], signal: TestCodeSignal): void {
  if (
    target.some(
      (existing) =>
        existing.kind === signal.kind &&
        existing.value === signal.value &&
        existing.line === signal.line
    )
  ) {
    return;
  }
  target.push(signal);
}

function collectStaticSignals(sourceText: string): {
  steps: TestStep[];
  expectations: TestStep[];
  codeSignals: TestCodeSignal[];
} {
  const steps: TestStep[] = [];
  const expectations: TestStep[] = [];
  const codeSignals: TestCodeSignal[] = [];
  const lines = sourceText.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;

    for (const match of trimmed.matchAll(TEST_STEP_PATTERN)) {
      pushUniqueStep(steps, { title: match[2]!, line: lineNo });
    }
    for (const match of trimmed.matchAll(ALLURE_STEP_PATTERN)) {
      const title = match[2]!;
      pushUniqueStep(steps, { title, line: lineNo });
      pushUniqueSignal(codeSignals, {
        kind: "allure-metadata",
        value: `allure.step(${JSON.stringify(title)})`,
        line: lineNo,
        source: "allure-metadata"
      });
    }

    if (/\bexpect\s*\(/.test(trimmed)) {
      const value = compactSourceLine(trimmed);
      pushUniqueStep(expectations, { title: value, line: lineNo });
      pushUniqueSignal(codeSignals, {
        kind: "assertion",
        value,
        line: lineNo,
        source: "static-analysis"
      });
    }

    for (const match of trimmed.matchAll(LOCATOR_CALL_PATTERN)) {
      const start = match.index ?? 0;
      const value = compactSourceLine(trimmed.slice(start));
      pushUniqueSignal(codeSignals, {
        kind: "locator",
        value,
        line: lineNo,
        source: "static-analysis"
      });
    }

    for (const match of trimmed.matchAll(ALLURE_METADATA_PATTERN)) {
      const start = match.index ?? 0;
      const value = compactSourceLine(trimmed.slice(start));
      pushUniqueSignal(codeSignals, {
        kind: "allure-metadata",
        value,
        line: lineNo,
        source: "allure-metadata"
      });
    }
  });

  return { steps, expectations, codeSignals };
}

async function readStaticSignalsForSpec(
  projectRoot: string,
  absolutePath: string,
  warnings: string[]
): Promise<ReturnType<typeof collectStaticSignals> | undefined> {
  if (!isInsideProject(projectRoot, absolutePath)) {
    warnings.push(`static analysis skipped non-project spec path ${path.basename(absolutePath)}.`);
    return undefined;
  }
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    warnings.push(`static analysis skipped unreadable spec ${path.relative(projectRoot, absolutePath)}.`);
    return undefined;
  }
  if (stat.size > STATIC_ANALYSIS_FILE_SIZE_CAP_BYTES) {
    warnings.push(
      `static analysis skipped ${path.relative(projectRoot, absolutePath)} because it exceeds ${STATIC_ANALYSIS_FILE_SIZE_CAP_BYTES} bytes.`
    );
    return undefined;
  }
  const text = await fs.readFile(absolutePath, "utf8");
  return collectStaticSignals(text);
}

function signalBelongsToTest(
  signal: TestStep | TestCodeSignal,
  test: TestCase,
  nextTestLine: number | undefined
): boolean {
  if (!signal.line) return false;
  return signal.line >= test.line && (nextTestLine === undefined || signal.line < nextTestLine);
}

export async function enrichSpecFilesWithStaticAnalysis(
  projectRoot: string,
  specs: SpecFile[]
): Promise<{ specs: SpecFile[]; warnings: string[] }> {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const warnings: string[] = [];
  const enriched: SpecFile[] = [];

  for (const spec of specs) {
    const analysis = await readStaticSignalsForSpec(
      resolvedProjectRoot,
      path.resolve(spec.filePath),
      warnings
    );
    if (!analysis) {
      enriched.push(spec);
      continue;
    }

    const tests = spec.tests.map((test, index) => {
      const nextTestLine = spec.tests[index + 1]?.line;
      const steps = analysis.steps.filter((step) =>
        signalBelongsToTest(step, test, nextTestLine)
      );
      const expectations = analysis.expectations.filter((step) =>
        signalBelongsToTest(step, test, nextTestLine)
      );
      const codeSignals = analysis.codeSignals.filter((signal) =>
        signalBelongsToTest(signal, test, nextTestLine)
      );
      if (steps.length === 0 && expectations.length === 0 && codeSignals.length === 0) {
        return test;
      }

      return {
        ...test,
        qaMetadata: {
          ...test.qaMetadata,
          steps,
          expectations,
          source:
            steps.length === 0 &&
            expectations.length === 0 &&
            codeSignals.some((signal) => signal.source === "allure-metadata")
              ? "allure-metadata"
              : "static-analysis",
          confidence: "medium"
        },
        codeSignals
      } satisfies TestCase;
    });

    enriched.push({ ...spec, tests });
  }

  return { specs: enriched, warnings };
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
  const enrichment = await enrichSpecFilesWithStaticAnalysis(request.projectRoot, specs);
  const enrichedSpecs = enrichment.specs;
  return {
    projectId: request.projectId,
    source: "playwright-list-json",
    generatedAt,
    specs: enrichedSpecs,
    totals: {
      specFiles: enrichedSpecs.length,
      tests: enrichedSpecs.reduce((acc, spec) => acc + spec.tests.length, 0)
    },
    warnings: [...warnings, ...enrichment.warnings],
    error: errors.length > 0 ? errors.join(" ") : undefined
  };
}
