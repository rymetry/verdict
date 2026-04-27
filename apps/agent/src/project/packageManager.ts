import * as path from "node:path";
import {
  type CommandTemplate,
  type DetectedPackageManager,
  type PackageManager,
  type PackageManagerDetectionStatus
} from "@pwqa/shared";

export interface PackageJsonView {
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface DetectionInput {
  projectRoot: string;
  packageJson?: PackageJsonView;
  /** Lockfile basenames present in projectRoot (e.g. ["package-lock.json"]). */
  lockfiles: ReadonlyArray<string>;
  /** Yarn 2+ Plug'n'Play marker. */
  hasYarnPnP: boolean;
  /** node_modules/.bin/playwright presence. */
  hasPlaywrightBinInNodeModules: boolean;
  /** Optional override from the GUI. */
  override?: PackageManager;
}

const LOCKFILE_TO_PM: Readonly<Record<string, PackageManager>> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun"
};

const PLAYWRIGHT_PACKAGE = "@playwright/test";

function parsePackageManagerField(value: string | undefined): PackageManager | undefined {
  if (!value) return undefined;
  const name = value.split("@", 1)[0]?.trim().toLowerCase();
  if (name === "npm" || name === "pnpm" || name === "yarn" || name === "bun") {
    return name;
  }
  return undefined;
}

function lockfilesToManagers(lockfiles: ReadonlyArray<string>): ReadonlyArray<PackageManager> {
  const seen = new Set<PackageManager>();
  for (const file of lockfiles) {
    const pm = LOCKFILE_TO_PM[file];
    if (pm) {
      seen.add(pm);
    }
  }
  return Array.from(seen);
}

function buildCommandTemplate(pm: PackageManager): CommandTemplate {
  switch (pm) {
    case "npm":
      // §8: `--no-install` blocks implicit npm-side fallback installs.
      return { executable: "npx", args: ["--no-install", "playwright", "test"] };
    case "pnpm":
      return { executable: "pnpm", args: ["exec", "playwright", "test"] };
    case "yarn":
      // Yarn Classic resolves via node_modules/.bin; Yarn PnP via .pnp.cjs. Both avoid implicit installs.
      return { executable: "yarn", args: ["playwright", "test"] };
    case "bun":
      // Phase 1.5 spike candidate. Real execution is blocked at the runtime layer.
      return { executable: "bunx", args: ["--no-install", "--bun", "playwright", "test"] };
  }
}

export interface PackageManagerDetector {
  detect(input: DetectionInput): DetectedPackageManager;
}

export function createPackageManagerDetector(): PackageManagerDetector {
  return {
    detect(input: DetectionInput): DetectedPackageManager {
      return detectPackageManager(input);
    }
  };
}

export function detectPackageManager(input: DetectionInput): DetectedPackageManager {
  const warnings: string[] = [];
  const errors: string[] = [];
  const lockfiles = [...input.lockfiles];
  const detectedFromLocks = lockfilesToManagers(lockfiles);
  const packageManagerField = parsePackageManagerField(input.packageJson?.packageManager);

  const hasPlaywrightDevDependency = Boolean(
    input.packageJson?.devDependencies?.[PLAYWRIGHT_PACKAGE] ??
      input.packageJson?.dependencies?.[PLAYWRIGHT_PACKAGE]
  );
  if (!input.packageJson) {
    errors.push("package.json not found in project root.");
  } else if (!hasPlaywrightDevDependency) {
    errors.push(
      `${PLAYWRIGHT_PACKAGE} is not listed in dependencies or devDependencies. Test execution is blocked.`
    );
  }

  let chosen: PackageManager;
  let reason: string;
  let status: PackageManagerDetectionStatus = "ok";
  let confidence: "high" | "medium" | "low" = "low";

  if (input.override) {
    chosen = input.override;
    reason = `Override provided via Workbench settings (${input.override}).`;
    confidence = "high";
  } else if (packageManagerField) {
    chosen = packageManagerField;
    reason = `Resolved from package.json#packageManager (${input.packageJson?.packageManager ?? ""}).`;
    confidence = "high";
    if (detectedFromLocks.length > 0 && !detectedFromLocks.includes(chosen)) {
      warnings.push(
        `package.json#packageManager indicates ${chosen} but lockfiles ${detectedFromLocks.join(", ")} disagree.`
      );
    }
  } else if (detectedFromLocks.length === 1) {
    chosen = detectedFromLocks[0]!;
    reason = `Single lockfile detected (${lockfiles.join(", ")}).`;
    confidence = "high";
  } else if (detectedFromLocks.length === 0) {
    chosen = "npm";
    reason = "No lockfile found. Falling back to npm with a warning.";
    status = "no-lockfile-fallback";
    confidence = "low";
    warnings.push(
      "No lockfile found. Defaulting to npm. Add a lockfile or set package.json#packageManager to silence this warning."
    );
  } else {
    chosen = detectedFromLocks[0]!;
    reason = `Multiple lockfiles found (${lockfiles.join(", ")}). Test execution is blocked until the user resolves the ambiguity.`;
    status = "ambiguous-lockfiles";
    confidence = "low";
    errors.push(
      `Ambiguous package manager: lockfiles indicate ${detectedFromLocks.join(", ")}. Set package.json#packageManager or remove the unused lockfiles.`
    );
  }

  let localBinaryUsable = false;
  switch (chosen) {
    case "npm":
      // `npx --no-install` only succeeds if node_modules/.bin/playwright exists.
      localBinaryUsable = input.hasPlaywrightBinInNodeModules;
      if (!localBinaryUsable && hasPlaywrightDevDependency) {
        warnings.push(
          "npm: node_modules/.bin/playwright is missing. Run `npm install` before executing tests; --no-install will not auto-install."
        );
      }
      break;
    case "pnpm":
      localBinaryUsable = input.hasPlaywrightBinInNodeModules;
      if (!localBinaryUsable && hasPlaywrightDevDependency) {
        warnings.push(
          "pnpm: pnpm exec resolves to node_modules/.bin or the workspace store; the project's local Playwright bin is missing. Run `pnpm install`."
        );
      }
      break;
    case "yarn":
      // Yarn Classic uses node_modules/.bin; Yarn PnP uses .pnp.cjs. Either is acceptable.
      localBinaryUsable = input.hasPlaywrightBinInNodeModules || input.hasYarnPnP;
      if (!localBinaryUsable && hasPlaywrightDevDependency) {
        warnings.push(
          "yarn: neither node_modules/.bin/playwright nor .pnp.cjs found. Run `yarn install` before executing tests."
        );
      }
      break;
    case "bun":
      // Bun is Phase 1.5; we do not advertise the bin as usable.
      localBinaryUsable = false;
      status = "experimental-bun";
      errors.push(
        "Bun is experimental (PLAN.v2 Phase 1.5). Test execution is blocked until the Bun feasibility spike completes."
      );
      break;
  }

  if (!hasPlaywrightDevDependency && status === "ok" && input.packageJson) {
    status = "missing-playwright";
  }
  if (!input.packageJson) {
    status = "no-package-json";
  }

  const blockingExecution =
    !hasPlaywrightDevDependency ||
    status === "ambiguous-lockfiles" ||
    status === "experimental-bun" ||
    status === "missing-playwright" ||
    status === "no-package-json" ||
    !localBinaryUsable;

  return {
    name: chosen,
    status,
    confidence,
    reason,
    warnings,
    errors,
    lockfiles,
    packageManagerField: input.packageJson?.packageManager,
    override: input.override,
    commandTemplates: {
      playwrightTest: buildCommandTemplate(chosen)
    },
    hasPlaywrightDevDependency,
    localBinaryUsable,
    blockingExecution
  };
}

export function lockfileSearchEntries(): ReadonlyArray<string> {
  return Object.keys(LOCKFILE_TO_PM);
}

export function nodeBinPlaywrightPath(projectRoot: string): string {
  return path.join(projectRoot, "node_modules", ".bin", "playwright");
}

export function yarnPnpMarkers(): ReadonlyArray<string> {
  return [".pnp.cjs", ".pnp.loader.mjs"];
}
