import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as fsSync from "node:fs";
import * as path from "node:path";
import {
  type DetectedPackageManager,
  type PackageManager,
  type ProjectSummary
} from "@pwqa/shared";
import {
  detectPackageManager,
  lockfileSearchEntries,
  nodeBinPlaywrightPath,
  yarnPnpMarkers,
  type PackageJsonView
} from "./packageManager.js";

const PLAYWRIGHT_CONFIG_CANDIDATES = [
  "playwright.config.ts",
  "playwright.config.js",
  "playwright.config.mjs",
  "playwright.config.cjs"
];

export interface ScanRequest {
  rootPath: string;
  packageManagerOverride?: PackageManager;
  /**
   * Optional allowlist of project root realpaths. When provided the scanner
   * refuses to open paths outside the list. Empty list disables the check.
   */
  allowedRoots?: ReadonlyArray<string>;
}

export interface ScanResult {
  summary: ProjectSummary;
  packageManager: DetectedPackageManager;
  /** Optional rejection reason. Present only when `summary` is undefined. */
  rejection?: string;
}

export class ProjectScanError extends Error {
  constructor(message: string, readonly code = "PROJECT_SCAN_ERROR") {
    super(message);
    this.name = "ProjectScanError";
  }
}

async function readPackageJson(rootPath: string): Promise<PackageJsonView | undefined> {
  const file = path.join(rootPath, "package.json");
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as PackageJsonView;
    }
    return undefined;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ProjectScanError(
      `Failed to read package.json: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function detectLockfiles(rootPath: string): Promise<string[]> {
  const candidates = lockfileSearchEntries();
  const found: string[] = [];
  for (const candidate of candidates) {
    if (existsSync(path.join(rootPath, candidate))) {
      found.push(candidate);
    }
  }
  return found;
}

async function detectPlaywrightConfig(rootPath: string): Promise<string | undefined> {
  for (const candidate of PLAYWRIGHT_CONFIG_CANDIDATES) {
    const filePath = path.join(rootPath, candidate);
    if (existsSync(filePath)) {
      return filePath;
    }
  }
  return undefined;
}

function detectYarnPnP(rootPath: string): boolean {
  return yarnPnpMarkers().some((marker) => existsSync(path.join(rootPath, marker)));
}

function detectPlaywrightBin(rootPath: string): boolean {
  return existsSync(nodeBinPlaywrightPath(rootPath));
}

function detectAllure(packageJson: PackageJsonView | undefined): {
  hasAllurePlaywright: boolean;
  hasAllureCli: boolean;
} {
  const deps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {})
  };
  return {
    hasAllurePlaywright: typeof deps["allure-playwright"] === "string",
    // Allure 3 ships the CLI under the package name `allure`; Allure 2 used
    // `allure-commandline`. T200 (PR #34) confirmed Phase 1.2 PoC targets
    // Allure 3, but `allure-commandline` is kept here for backward-compat
    // signalling — either is enough at scanner stage to indicate "an Allure
    // CLI is locally available". The exact CLI version check lives in T204
    // when the run pipeline actually invokes `allure --version`.
    hasAllureCli:
      typeof deps["allure"] === "string" ||
      typeof deps["allure-commandline"] === "string"
  };
}

/**
 * Heuristic detector for the `allure-playwright` reporter `resultsDir` option
 * inside a `playwright.config.{ts,js,mjs,cjs}` file. Returns the literal
 * string when it can be statically extracted; emits a warning (returned
 * separately) when the config likely uses Allure but the reporter clause is
 * dynamic / non-static. Safe-by-default: any extracted path that fails
 * validation (absolute, traversal, empty, NUL, Windows-drive) is rejected.
 *
 * Limitations (intentional, per T203-1 design memo):
 *   - Text-based regex, not AST. ts-morph is deferred to Phase 5 (PLAN.v2 §24).
 *   - Cannot evaluate environment variable references etc — regex requires a
 *     plain quoted literal in the `resultsDir` slot.
 *   - Relies on the reporter clause being colocated within ~one block; deeply
 *     nested compositions may not match. False negatives are preferred over
 *     false positives (silent miss > confidently wrong path).
 */
const ALLURE_REPORTER_RESULTS_DIR_PATTERN =
  /['"]allure-playwright['"][\s\S]*?\bresultsDir\s*:\s*(['"])([^'"\\]+)\1/;
const ALLURE_REPORTER_PRESENCE_PATTERN = /['"]allure-playwright['"]/;

function detectAllureResultsDir(configText: string): {
  resultsDir?: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const presence = ALLURE_REPORTER_PRESENCE_PATTERN.test(configText);
  if (!presence) {
    // Reporter not referenced at all — nothing to detect, no warning.
    return { warnings };
  }

  const match = ALLURE_REPORTER_RESULTS_DIR_PATTERN.exec(configText);
  if (!match) {
    // Reporter is referenced but no `resultsDir: "..."` literal found. Could
    // be a reporter without options (defaults to `allure-results`) or a
    // dynamic value that the regex cannot evaluate. Emit a soft warning so
    // the run pipeline (T203-2/T203-3) knows to fall back to user override
    // or the default.
    warnings.push(
      "allure-playwright reporter detected but resultsDir is missing or dynamic; Workbench will rely on user override or the default 'allure-results'."
    );
    return { warnings };
  }

  const candidate = match[2] ?? "";
  if (candidate.length === 0) {
    warnings.push("allure-playwright resultsDir is empty; ignoring detection.");
    return { warnings };
  }
  if (candidate.includes("\0")) {
    warnings.push("allure-playwright resultsDir contains a NUL byte; ignoring detection.");
    return { warnings };
  }
  if (candidate.includes("..")) {
    warnings.push("allure-playwright resultsDir contains '..' (path traversal); ignoring detection.");
    return { warnings };
  }
  if (path.isAbsolute(candidate)) {
    warnings.push("allure-playwright resultsDir is an absolute path; only project-relative paths are supported.");
    return { warnings };
  }
  if (/^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith("\\\\")) {
    warnings.push("allure-playwright resultsDir uses a Windows-drive path; only project-relative paths are supported.");
    return { warnings };
  }

  return { resultsDir: candidate, warnings };
}

async function safeReadConfigText(configPath: string | undefined): Promise<string | undefined> {
  if (!configPath) return undefined;
  try {
    return await fs.readFile(configPath, "utf8");
  } catch {
    // Best-effort: a config we just confirmed exists could fail to read on
    // permission flips. Detection is non-load-bearing for run execution
    // itself (the actual Playwright CLI handles config loading), so we
    // swallow here and let the rest of scanProject continue.
    return undefined;
  }
}

function ensureWithinAllowed(rootRealpath: string, allowed?: ReadonlyArray<string>): void {
  if (!allowed || allowed.length === 0) return;
  const inside = allowed.some((entry) => {
    const rel = path.relative(entry, rootRealpath);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!inside) {
    throw new ProjectScanError(
      `Project root ${rootRealpath} is not in the allowed root list.`,
      "PROJECT_NOT_ALLOWED"
    );
  }
}

export async function scanProject(request: ScanRequest): Promise<ScanResult> {
  const expanded = path.resolve(request.rootPath);
  let realpath: string;
  try {
    realpath = fsSync.realpathSync(expanded);
  } catch (error) {
    throw new ProjectScanError(
      `Project root '${expanded}' is not accessible: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "PROJECT_NOT_FOUND"
    );
  }

  ensureWithinAllowed(realpath, request.allowedRoots);

  const stats = await fs.stat(realpath);
  if (!stats.isDirectory()) {
    throw new ProjectScanError(
      `Project root '${realpath}' is not a directory.`,
      "PROJECT_NOT_DIRECTORY"
    );
  }

  const packageJson = await readPackageJson(realpath);
  const lockfiles = await detectLockfiles(realpath);
  const playwrightConfigPath = await detectPlaywrightConfig(realpath);
  const hasYarnPnP = detectYarnPnP(realpath);
  const hasPlaywrightBinInNodeModules = detectPlaywrightBin(realpath);
  const { hasAllurePlaywright, hasAllureCli } = detectAllure(packageJson);
  // Read the Playwright config text and run a heuristic Allure resultsDir
  // detection. Non-load-bearing for run execution; T203-2 will use it for
  // archive/copy decisions, falling back to default or user override when
  // detection fails (warning emitted in that case).
  const configText = await safeReadConfigText(playwrightConfigPath);
  const allureDetection = configText
    ? detectAllureResultsDir(configText)
    : { resultsDir: undefined, warnings: [] };

  const packageManager = detectPackageManager({
    projectRoot: realpath,
    packageJson,
    lockfiles,
    hasYarnPnP,
    hasPlaywrightBinInNodeModules,
    override: request.packageManagerOverride
  });

  const warnings: string[] = [];
  if (!playwrightConfigPath) {
    warnings.push(
      "playwright.config.{ts,js,mjs,cjs} was not found at the project root. Workbench will rely on Playwright's default config discovery."
    );
  }
  if (!packageJson) {
    warnings.push("package.json is missing at the project root.");
  }
  // Surface Allure detection warnings on the project summary so the GUI /
  // run pipeline can present remediation hints (e.g. "configure resultsDir
  // explicitly" or "supply a Workbench override").
  warnings.push(...allureDetection.warnings);

  const summary: ProjectSummary = {
    id: realpath,
    rootPath: realpath,
    packageJsonPath: packageJson ? path.join(realpath, "package.json") : undefined,
    playwrightConfigPath,
    packageManager,
    hasAllurePlaywright,
    hasAllureCli,
    allureResultsDir: allureDetection.resultsDir,
    warnings,
    blockingExecution: packageManager.blockingExecution
  };

  return { summary, packageManager };
}
