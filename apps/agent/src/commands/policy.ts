import * as path from "node:path";

export interface CommandPolicy {
  /**
   * Allowed executable names. Each is matched on the command's basename
   * after path resolution. Phase 1 PoC permits the package managers we
   * actually invoke (npx/pnpm/yarn) plus utility binaries (`node`, `git`,
   * `allure`, `playwright`). Bun-related binaries are intentionally NOT
   * allowed by default — the Bun feasibility spike (PLAN.v2 Phase 1.5)
   * must opt them in explicitly via a custom policy.
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
  "playwright",
  "node",
  "git",
  "allure"
];

/**
 * Default arg allowlist for `npx`: forces a `--no-install` flag plus the
 * `playwright` package as the first positional. This blocks the
 * `npx <arbitrary-package>` escape route (PLAN.v2 §14).
 */
export const DEFAULT_NPX_ARG_PATTERNS: ReadonlyArray<RegExp> = [
  /^--no-install$/,
  /^playwright$/,
  /^test$/,
  /^--list$/,
  /^--reporter=list,json,html$/,
  /^--reporter=json$/,
  /^--reporter=list,json,html(,allure-playwright)?$/,
  /^--headed$/,
  /^--grep$/,
  /^--project$/,
  // Spec / project-name / grep value: relative path or simple identifier.
  /^[A-Za-z0-9._\-/@]+$/
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
