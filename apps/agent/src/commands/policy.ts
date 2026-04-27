import * as path from "node:path";

export interface CommandPolicy {
  /**
   * Allowed executable names. Each is matched on the command's basename
   * after path resolution. `npx`, `pnpm`, `yarn`, `bunx`, `playwright`,
   * `git`, `allure`, `node` are the PoC-allowed executables.
   */
  allowedExecutables: ReadonlyArray<string>;
  /**
   * Optional positional-arg allowlists per executable. When omitted,
   * any args are accepted. PoC §14: `npm run <script>` is forbidden by
   * not allowing `npm` here.
   */
  argAllowlists?: Readonly<Record<string, ReadonlyArray<RegExp>>>;
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
  "yarn",
  "bunx",
  "playwright",
  "node",
  "git",
  "allure"
];

export const DEFAULT_ENV_ALLOWLIST: ReadonlyArray<string> = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TZ",
  "PWD",
  "NODE_OPTIONS",
  "CI",
  // Playwright runtime knobs (PLAN.v2 §28: secret allowlist; do not pass arbitrary env).
  "PLAYWRIGHT_BROWSERS_PATH",
  "PLAYWRIGHT_HTML_REPORT",
  "PLAYWRIGHT_JSON_OUTPUT_NAME",
  "PLAYWRIGHT_DISABLE_SELF_UPDATE",
  "DEBUG",
  "FORCE_COLOR",
  "NO_COLOR",
  "TERM"
];

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
