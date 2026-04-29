import * as path from "node:path";
import * as fs from "node:fs";

export type CommandArgsValidationCode =
  | "unsupported-executable"
  | "invalid-prefix"
  | "nul-byte"
  | "argument-too-long"
  | "missing-flag-value"
  | "disallowed-flag"
  | "invalid-uri-encoding"
  | "decode-depth-exceeded"
  | "absolute-path"
  | "path-traversal"
  | "flag-like-operand"
  // T204-2: Allure generate-specific codes. Each one is a distinct
  // operator-actionable misconfiguration so log aggregators can
  // pattern-match without parsing free text.
  | "missing-subcommand"
  | "disallowed-subcommand"
  | "duplicate-output-flag"
  | "duplicate-flag"
  | "extra-positional"
  | "missing-results-dir"
  | "missing-output-flag";

export type CommandArgsValidationResult =
  | { ok: true }
  | { ok: false; code: CommandArgsValidationCode; message: string };

export type CommandArgsValidator = (input: {
  executableName: string;
  args: ReadonlyArray<string>;
}) => CommandArgsValidationResult;

export const argsValid = Object.freeze({ ok: true } satisfies CommandArgsValidationResult);

export function argsInvalid(
  code: CommandArgsValidationCode,
  message: string
): CommandArgsValidationResult {
  return { ok: false, code, message };
}

export interface CommandPolicy {
  /**
   * Allowed executable names. Each is matched on the command's basename
   * after path resolution. Phase 1 default permits only package managers
   * used to invoke the user's local Playwright binary. Git / Allure / Bun
   * must opt in through adapter-specific policies when those phases land.
   */
  allowedExecutables: ReadonlyArray<string>;
  /**
   * Optional positional-arg allowlists per executable. `npm` is intentionally
   * absent from the default executables so `npm run <script>` cannot bypass the
   * Playwright-specific argv validator.
   */
  argAllowlists?: Readonly<Record<string, ReadonlyArray<RegExp>>>;
  /**
   * Validator that can inspect the whole argv sequence. Playwright
   * flags such as `--grep <value>` need pair-aware validation so Japanese
   * text, spaces, and regex syntax are not accidentally rejected.
   * Custom policies that intentionally allow arbitrary args must opt in via
   * `unsafelyAllowAnyArgsValidator()` instead of omitting validation.
   */
  argValidator: CommandArgsValidator;
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
  // Phase 1.2 (T204): the Allure 3 CLI ships as the npm package `allure`.
  // Workbench invokes it via the project-local `node_modules/.bin/allure`
  // (not a global install) so the basename match against this allowlist is
  // sufficient. The argument-validation logic for Allure subcommands lives
  // in T204-2 (separate sub-policy from Playwright args).
  "allure"
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
  // Additional reporters should be allowed through dedicated adapter policies,
  // not by widening the default Playwright execution policy.
  "--reporter=list,json,html"
]);

const MAX_ARG_LENGTH = 4_096;
// Deep enough for nested URL-encoding seen in traversal probes, bounded so
// malformed or adversarial input cannot spend unbounded CPU in validation.
const MAX_DECODE_DEPTH = 8;

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

type DecodeRepeatedlyResult =
  | { ok: true; value: string }
  | { ok: false; code: "invalid-uri-encoding" | "decode-depth-exceeded" };

function validateProjectRelativeOperand(value: string): CommandArgsValidationResult {
  if (isFlagValue(value)) {
    return argsInvalid("flag-like-operand", `Spec operand '${value}' must not look like a flag.`);
  }
  if (path.isAbsolute(value)) {
    return argsInvalid("absolute-path", `Spec operand '${value}' must be project-relative.`);
  }
  const decoded = decodeRepeatedly(value);
  if (!decoded.ok) {
    return argsInvalid(
      decoded.code,
      decoded.code === "invalid-uri-encoding"
        ? `Spec operand '${value}' contains invalid percent encoding.`
        : `Spec operand '${value}' exceeded the maximum percent-decoding depth.`
    );
  }
  if (path.isAbsolute(decoded.value)) {
    return argsInvalid("absolute-path", `Spec operand '${value}' must decode to a project-relative path.`);
  }
  const parts = decoded.value.split(/[\\/]+/);
  if (parts.includes("..")) {
    return argsInvalid("path-traversal", `Spec operand '${value}' must stay inside the project root.`);
  }
  return argsValid;
}

function decodeRepeatedly(value: string): DecodeRepeatedlyResult {
  let current = value;
  for (let depth = 0; depth < MAX_DECODE_DEPTH; depth += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return { ok: false, code: "invalid-uri-encoding" };
    }
    if (next === current) return { ok: true, value: current };
    current = next;
  }
  return { ok: false, code: "decode-depth-exceeded" };
}

function validateArgValue(value: string): CommandArgsValidationResult {
  if (value.includes("\0")) {
    return argsInvalid("nul-byte", "Arguments must not contain NUL bytes.");
  }
  if (value.length > MAX_ARG_LENGTH) {
    return argsInvalid(
      "argument-too-long",
      `Arguments must be ${MAX_ARG_LENGTH} characters or fewer.`
    );
  }
  return argsValid;
}

export function validatePhase1PlaywrightArgs({
  executableName,
  args
}: {
  executableName: string;
  args: ReadonlyArray<string>;
}): CommandArgsValidationResult {
  const prefix = PLAYWRIGHT_PREFIXES[executableName];
  if (!prefix) {
    return argsInvalid(
      "unsupported-executable",
      `Executable '${executableName}' is not supported by the default Phase 1 Playwright policy.`
    );
  }
  if (!hasPrefix(args, prefix)) {
    return argsInvalid(
      "invalid-prefix",
      `'${executableName}' must invoke the local Playwright test command with the approved prefix: ${prefix.join(" ")}`
    );
  }

  for (const arg of args) {
    const valueError = validateArgValue(arg);
    if (!valueError.ok) return valueError;
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
        return argsInvalid("missing-flag-value", `${arg} must be followed by a non-flag value.`);
      }
      index += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      return argsInvalid(
        "disallowed-flag",
        `Flag '${arg}' is not allowed for the default Phase 1 Playwright policy.`
      );
    }
    const operandResult = validateProjectRelativeOperand(arg);
    if (!operandResult.ok) return operandResult;
    index += 1;
  }

  return argsValid;
}

export function unsafelyAllowAnyArgsValidator(): CommandArgsValidationResult {
  return argsValid;
}

export function createDefaultCommandPolicy(cwdBoundary: string): CommandPolicy {
  return {
    allowedExecutables: DEFAULT_ALLOWED_EXECUTABLES,
    argValidator: validatePhase1PlaywrightArgs,
    cwdBoundary: fs.realpathSync(cwdBoundary),
    envAllowlist: DEFAULT_ENV_ALLOWLIST
  };
}

/* ----------------------------------------------------------------- */
/* T204-2: Allure CLI argument validation policy                     */
/* ----------------------------------------------------------------- */

/**
 * Allowed Allure subcommands for Phase 1.2. The validator pins these
 * exactly — adding more (`open`, `quality-gate`, `csv`, `log`) needs an
 * explicit policy update plus dedicated tests so each new attack
 * surface is reviewed deliberately. T205 (Quality Gate) and T207
 * (CSV/log) extend this set when their producers land.
 */
const ALLOWED_ALLURE_SUBCOMMANDS = new Set(["generate"]);

/**
 * Allure flags that take a value in the next argv slot. Validated
 * separately from positional operands so a typo like `--output` without
 * a value cannot silently be treated as an operand.
 */
const ALLURE_GENERATE_VALUE_FLAGS = new Set(["-o", "--output", "--config", "--report-name"]);

/**
 * Allure flags that stand alone (boolean / behavioral toggles).
 */
const ALLURE_GENERATE_STANDALONE_FLAGS = new Set(["--clean"]);

/**
 * Args validator for `allure generate ...`. Phase 1.2 / T204-2.
 *
 * Workbench builds the entire arg vector itself (no user input flows in),
 * so this validator is conservative — it accepts only the precise shape
 * Workbench will emit, and rejects anything else as a defense-in-depth
 * safeguard against future code changes that accidentally widen the
 * surface.
 *
 * Accepted shape (any order, after subcommand):
 *   `generate <results-dir> -o <report-dir> --clean`
 *   `generate <results-dir> --output <report-dir> --clean`
 *
 * - subcommand must be `generate`
 * - exactly one positional results-dir (project-relative, no traversal)
 * - exactly one `-o <dir>` / `--output <dir>` (project-relative)
 * - any number of standalone flags from ALLURE_GENERATE_STANDALONE_FLAGS
 * - other value flags (`--config`, `--report-name`) are accepted but the
 *   value must be project-relative path-safe (config) or a stable token
 *   that's not a flag-like
 *
 * Anything else (other subcommands, unknown flags, multiple positionals,
 * absolute paths, traversal, NUL bytes, oversized args) is rejected.
 */
export function validateAllureGenerateArgs({
  executableName,
  args
}: {
  executableName: string;
  args: ReadonlyArray<string>;
}): CommandArgsValidationResult {
  if (executableName !== "allure") {
    return argsInvalid(
      "unsupported-executable",
      `Executable '${executableName}' is not supported by the Allure-generate policy.`
    );
  }

  // Reject empty, NUL, oversized at the per-arg level first.
  for (const arg of args) {
    const valueError = validateArgValue(arg);
    if (!valueError.ok) return valueError;
  }

  // First positional must be the subcommand `generate`.
  if (args.length === 0) {
    return argsInvalid("missing-subcommand", "Allure command must specify a subcommand.");
  }
  const subcommand = args[0]!;
  if (!ALLOWED_ALLURE_SUBCOMMANDS.has(subcommand)) {
    return argsInvalid(
      "disallowed-subcommand",
      `Allure subcommand '${subcommand}' is not allowed by the Phase 1.2 policy.`
    );
  }

  let positionalCount = 0;
  let outputSeen = false;
  // Track other value flags so duplicates fail closed. Each non-output
  // value flag is allowed AT MOST once — duplicates would either confuse
  // the Allure CLI (`--config` whose precedence is implementation-defined)
  // or signal a programmer error in the argv builder. Defense-in-depth
  // per the validator's "Workbench-only argv" doctrine.
  const seenNonOutputValueFlags = new Set<string>();
  let index = 1;
  while (index < args.length) {
    const arg = args[index]!;
    if (ALLURE_GENERATE_STANDALONE_FLAGS.has(arg)) {
      index += 1;
      continue;
    }
    if (ALLURE_GENERATE_VALUE_FLAGS.has(arg)) {
      const value = args[index + 1];
      if (value === undefined || isFlagValue(value)) {
        return argsInvalid("missing-flag-value", `${arg} must be followed by a non-flag value.`);
      }
      // -o / --output / --config: must look like a project-relative path.
      // --report-name: any non-flag string is acceptable (but still
      // path-redacted at the arg-value level).
      if (arg === "-o" || arg === "--output" || arg === "--config") {
        const operandResult = validateProjectRelativeOperand(value);
        if (!operandResult.ok) return operandResult;
      }
      if (arg === "-o" || arg === "--output") {
        // Both forms are synonyms — duplicate detection covers same-flag
        // (`-o ... -o ...`) AND mixed-synonym (`-o ... --output ...`).
        if (outputSeen) {
          return argsInvalid(
            "duplicate-output-flag",
            "Allure generate must be invoked with a single output flag."
          );
        }
        outputSeen = true;
      } else {
        // Other value flags: pin to single occurrence to keep argv shape
        // deterministic. Allure CLI's behavior with duplicate --config /
        // --report-name is implementation-defined, which violates the
        // "validator accepts only the precise Workbench shape" doctrine.
        if (seenNonOutputValueFlags.has(arg)) {
          return argsInvalid(
            "duplicate-flag",
            `Flag '${arg}' must not appear more than once for the Allure-generate policy.`
          );
        }
        seenNonOutputValueFlags.add(arg);
      }
      index += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      return argsInvalid(
        "disallowed-flag",
        `Flag '${arg}' is not allowed by the Allure-generate policy.`
      );
    }
    // Positional operand: the results-dir to read from.
    const operandResult = validateProjectRelativeOperand(arg);
    if (!operandResult.ok) return operandResult;
    positionalCount += 1;
    if (positionalCount > 1) {
      return argsInvalid(
        "extra-positional",
        "Allure generate accepts only one positional results-dir argument."
      );
    }
    index += 1;
  }

  if (positionalCount !== 1) {
    return argsInvalid(
      "missing-results-dir",
      "Allure generate must specify a positional results-dir argument."
    );
  }
  if (!outputSeen) {
    return argsInvalid(
      "missing-output-flag",
      "Allure generate must specify an explicit output directory via -o or --output."
    );
  }

  return argsValid;
}

/**
 * Allure-specific CommandPolicy factory. T204-2.
 * Used by T204-3 when RunManager invokes the Allure CLI subprocess for
 * HTML report generation. Distinct from `createDefaultCommandPolicy`
 * (Playwright policy) because the args validator surface is entirely
 * different.
 */
export function createAllureCommandPolicy(cwdBoundary: string): CommandPolicy {
  return {
    allowedExecutables: ["allure"],
    argValidator: validateAllureGenerateArgs,
    cwdBoundary: fs.realpathSync(cwdBoundary),
    envAllowlist: DEFAULT_ENV_ALLOWLIST
  };
}
