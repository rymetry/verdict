import * as path from "node:path";
import * as fs from "node:fs";

export type CommandArgsValidator = (input: {
  executableName: string;
  args: ReadonlyArray<string>;
}) => string | null;

export interface CommandPolicy {
  /**
   * Allowed executable names. Each is matched on the command's basename
   * after path resolution. Phase 1 default permits only package managers
   * used to invoke the user's local Playwright binary. Git / Allure / Bun
   * must opt in through adapter-specific policies when those phases land.
   */
  allowedExecutables: ReadonlyArray<string>;
  /**
   * Optional positional-arg allowlists per executable. When omitted,
   * any args are accepted. PoC §14: `npm run <script>` is forbidden by
   * not allowing `npm` here.
   */
  argAllowlists?: Readonly<Record<string, ReadonlyArray<RegExp>>>;
  /**
   * Optional validator that can inspect the whole argv sequence. Playwright
   * flags such as `--grep <value>` need pair-aware validation so Japanese
   * text, spaces, and regex syntax are not accidentally rejected.
   */
  argValidator?: CommandArgsValidator;
  /**
   * Realpath of the project root. The command's `cwd` must be inside
   * this directory.
   */
  cwdBoundary: string;
  /** Allowed env var names (substring match disabled, exact match only). */
  envAllowlist: ReadonlyArray<string>;
}

export const DEFAULT_ALLOWED_EXECUTABLES: ReadonlyArray<string> = [
  "npx",
  "pnpm",
  "yarn"
];

/**
 * Env allowlist *intentionally* excludes `NODE_OPTIONS`. NODE_OPTIONS can
 * inject arbitrary code via `--require` / `--import` / `--loader` and would
 * undermine the executable allowlist. If a downstream user needs it, they
 * must opt in via a custom policy.
 */
export const DEFAULT_ENV_ALLOWLIST: ReadonlyArray<string> = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TZ",
  "PWD",
  "CI",
  // Playwright runtime knobs (PLAN.v2 §28: secret allowlist; do not pass arbitrary env).
  "PLAYWRIGHT_BROWSERS_PATH",
  "PLAYWRIGHT_HTML_REPORT",
  "PLAYWRIGHT_HTML_OPEN",
  "PLAYWRIGHT_JSON_OUTPUT_NAME",
  "PLAYWRIGHT_DISABLE_SELF_UPDATE",
  "DEBUG",
  "FORCE_COLOR",
  "NO_COLOR",
  "TERM"
];

const PLAYWRIGHT_PREFIXES: Readonly<Record<string, ReadonlyArray<string>>> = {
  npx: ["--no-install", "playwright", "test"],
  pnpm: ["exec", "playwright", "test"],
  yarn: ["playwright", "test"]
};

const SINGLE_FLAGS = new Set([
  "--list",
  "--headed",
  "--reporter=json",
  // Allure reporter is intentionally excluded from the Phase 1 default policy.
  // Phase 1.2 should add it through a dedicated adapter/policy, not by widening this default.
  "--reporter=list,json,html"
]);

const MAX_ARG_LENGTH = 4_096;

export function resolveExecutableName(executable: string): string {
  return path.basename(executable);
}

export function envAllowlistFilter(
  env: NodeJS.ProcessEnv,
  allowlist: ReadonlyArray<string>
): NodeJS.ProcessEnv {
  const filtered: NodeJS.ProcessEnv = {};
  const set = new Set(allowlist);
  for (const [key, value] of Object.entries(env)) {
    if (set.has(key) && typeof value === "string") {
      filtered[key] = value;
    }
  }
  return filtered;
}

function hasPrefix(args: ReadonlyArray<string>, prefix: ReadonlyArray<string>): boolean {
  return prefix.every((value, index) => args[index] === value);
}

function isFlagValue(value: string): boolean {
  return value.length === 0 || value.startsWith("-");
}

function isProjectRelativeOperand(value: string): boolean {
  if (isFlagValue(value)) return false;
  if (path.isAbsolute(value)) return false;
  const parts = value.split(/[\\/]+/);
  if (parts.includes("..")) return false;
  try {
    const onceDecoded = decodeURIComponent(value);
    const decoded = onceDecoded === value ? onceDecoded : decodeURIComponent(onceDecoded);
    const decodedParts = decoded.split(/[\\/]+/);
    return !decodedParts.includes("..");
  } catch {
    return false;
  }
}

function validateArgValue(value: string): string | null {
  if (value.includes("\0")) {
    return "Arguments must not contain NUL bytes.";
  }
  if (value.length > MAX_ARG_LENGTH) {
    return `Arguments must be ${MAX_ARG_LENGTH} characters or fewer.`;
  }
  return null;
}

export function validatePhase1PlaywrightArgs({
  executableName,
  args
}: {
  executableName: string;
  args: ReadonlyArray<string>;
}): string | null {
  const prefix = PLAYWRIGHT_PREFIXES[executableName];
  if (!prefix) {
    return `Executable '${executableName}' is not supported by the default Phase 1 Playwright policy.`;
  }
  if (!hasPrefix(args, prefix)) {
    return `'${executableName}' must invoke the local Playwright test command with the approved prefix: ${prefix.join(" ")}`;
  }

  for (const arg of args) {
    const valueError = validateArgValue(arg);
    if (valueError) return valueError;
  }

  let index = prefix.length;
  while (index < args.length) {
    const arg = args[index]!;
    if (SINGLE_FLAGS.has(arg)) {
      index += 1;
      continue;
    }
    if (arg === "--grep" || arg === "--project") {
      const value = args[index + 1];
      if (value === undefined || isFlagValue(value)) {
        return `${arg} must be followed by a non-flag value.`;
      }
      index += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      return `Flag '${arg}' is not allowed for the default Phase 1 Playwright policy.`;
    }
    if (!isProjectRelativeOperand(arg)) {
      return `Spec operand '${arg}' must be a project-relative path inside the project root.`;
    }
    index += 1;
  }

  return null;
}

export function createDefaultCommandPolicy(cwdBoundary: string): CommandPolicy {
  return {
    allowedExecutables: DEFAULT_ALLOWED_EXECUTABLES,
    argValidator: validatePhase1PlaywrightArgs,
    cwdBoundary: fs.realpathSync(cwdBoundary),
    envAllowlist: DEFAULT_ENV_ALLOWLIST
  };
}
