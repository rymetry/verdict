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
    hasAllureCli: typeof deps["allure-commandline"] === "string"
  };
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

  const summary: ProjectSummary = {
    id: realpath,
    rootPath: realpath,
    packageJsonPath: packageJson ? path.join(realpath, "package.json") : undefined,
    playwrightConfigPath,
    packageManager,
    hasAllurePlaywright,
    hasAllureCli,
    warnings,
    blockingExecution: packageManager.blockingExecution
  };

  return { summary, packageManager };
}
