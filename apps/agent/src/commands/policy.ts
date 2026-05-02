import * as path from "node:path";
import * as fs from "node:fs";

export type CommandArgsValidationCode =
  | "unsupported-executable"
  | "invalid-prefix"
  | "nul-byte"
  | "argument-too-long"
  | "missing-flag-value"
  | "invalid-numeric-value"
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
  | "missing-output-flag"
  | "missing-history-path-flag"
  | "invalid-json-schema"
  | "disallowed-operand";

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

const PLAYWRIGHT_EXEC_PREFIXES: Readonly<Record<string, ReadonlyArray<string>>> = {
  npx: ["--no-install", "playwright"],
  pnpm: ["exec", "playwright"],
  yarn: ["playwright"]
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

function httpUrl(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.startsWith("https://") || lower.startsWith("http://");
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
    if (arg === "--config") {
      const value = args[index + 1];
      if (value === undefined || isFlagValue(value)) {
        return argsInvalid("missing-flag-value", `${arg} must be followed by a non-flag value.`);
      }
      const operandResult = validateProjectRelativeOperand(value);
      if (!operandResult.ok) return operandResult;
      index += 2;
      continue;
    }
    if (arg === "--retries" || arg === "--workers") {
      const value = args[index + 1];
      if (value === undefined || isFlagValue(value)) {
        return argsInvalid("missing-flag-value", `${arg} must be followed by a numeric value.`);
      }
      if (!/^\d+$/.test(value) || (arg === "--workers" && Number(value) === 0)) {
        return argsInvalid("invalid-numeric-value", `${arg} must be a valid numeric value.`);
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

export function validatePlaywrightLaunchArgs({
  executableName,
  args
}: {
  executableName: string;
  args: ReadonlyArray<string>;
}): CommandArgsValidationResult {
  const prefix = PLAYWRIGHT_EXEC_PREFIXES[executableName];
  if (!prefix) {
    return argsInvalid(
      "unsupported-executable",
      `Executable '${executableName}' is not supported for Playwright launch commands.`
    );
  }
  if (!hasPrefix(args, prefix)) {
    return argsInvalid(
      "invalid-prefix",
      `'${executableName}' must invoke the local Playwright binary with the approved prefix: ${prefix.join(" ")}`
    );
  }
  for (const arg of args) {
    const valueError = validateArgValue(arg);
    if (!valueError.ok) return valueError;
  }

  const rest = args.slice(prefix.length);
  const [subcommand, firstOperand, secondOperand] = rest;
  if (subcommand === "test") {
    return rest.length === 2 && firstOperand === "--ui"
      ? argsValid
      : argsInvalid("disallowed-operand", "UI Mode must be invoked as 'playwright test --ui'.");
  }
  if (subcommand === "codegen") {
    if (rest.length === 1) return argsValid;
    if (rest.length === 2 && firstOperand && httpUrl(firstOperand)) return argsValid;
    return argsInvalid("disallowed-operand", "Codegen only accepts an optional http(s) URL.");
  }
  if (subcommand === "show-trace") {
    if (rest.length !== 2 || !firstOperand || secondOperand !== undefined) {
      return argsInvalid("missing-flag-value", "Trace Viewer requires exactly one trace zip path.");
    }
    if (path.extname(firstOperand).toLowerCase() !== ".zip") {
      return argsInvalid("disallowed-operand", "Trace Viewer only accepts .zip trace files.");
    }
    return validateProjectRelativeOperand(firstOperand);
  }
  return argsInvalid("disallowed-subcommand", `Playwright subcommand '${subcommand ?? ""}' is not allowed.`);
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
 * exactly — adding more (notably `open`, which can start a server)
 * needs an explicit policy update plus dedicated tests so each new
 * attack surface is reviewed deliberately.
 */
const ALLOWED_ALLURE_SUBCOMMANDS = new Set([
  "generate",
  "quality-gate",
  "history",
  "csv",
  "log",
  "known-issue"
]);

/**
 * Per-subcommand value flag sets. Validated separately from positional
 * operands so a typo (e.g. `--output` without a value) cannot silently
 * be treated as an operand.
 *
 * `generate` flags:
 *   -o / --output  : project-relative output dir
 *   --config       : project-relative path
 *   --report-name  : free-form name (no path validation)
 *
 * `history` flags:
 *   -h / --history-path : project-relative JSONL path
 *   --history-limit     : numeric
 *   --report-name       : free-form name
 *
 * `csv` flags:
 *   -o / --output   : project-relative output file
 *   --config        : project-relative path
 *   --separator     : free-form separator
 *   --known-issues  : project-relative path
 *
 * `log` flags:
 *   --config        : project-relative path
 *   --group-by      : free-form grouping token
 *
 * `known-issue` flags:
 *   -o / --output   : project-relative output file
 *
 * `quality-gate` flags (T205-1):
 *   --max-failures      : numeric (CLI rejects malformed)
 *   --min-tests-count   : numeric (CLI rejects malformed)
 *   --success-rate      : numeric percentage (CLI rejects malformed)
 *   --known-issues      : project-relative path
 */
const ALLURE_GENERATE_VALUE_FLAGS = new Set([
  "-o",
  "--output",
  "--config",
  "--report-name",
  "--name"
]);
const ALLURE_QUALITY_GATE_VALUE_FLAGS = new Set([
  "--max-failures",
  "--min-tests-count",
  "--success-rate",
  "--known-issues"
]);
const ALLURE_HISTORY_VALUE_FLAGS = new Set([
  "-h",
  "--history-path",
  "--history-limit",
  "--report-name",
  "--name"
]);
const ALLURE_CSV_VALUE_FLAGS = new Set([
  "-o",
  "--output",
  "--config",
  "--separator",
  "--known-issues"
]);
const ALLURE_LOG_VALUE_FLAGS = new Set([
  "--config",
  "--group-by"
]);
const ALLURE_KNOWN_ISSUE_VALUE_FLAGS = new Set([
  "-o",
  "--output"
]);

/**
 * Per-subcommand standalone flag sets (boolean / behavioral toggles).
 */
const ALLURE_GENERATE_STANDALONE_FLAGS = new Set<string>();
const ALLURE_QUALITY_GATE_STANDALONE_FLAGS = new Set(["--fast-fail"]);
const ALLURE_HISTORY_STANDALONE_FLAGS = new Set<string>();
const ALLURE_CSV_STANDALONE_FLAGS = new Set(["--disable-headers"]);
const ALLURE_LOG_STANDALONE_FLAGS = new Set(["--all-steps", "--with-trace"]);
const ALLURE_KNOWN_ISSUE_STANDALONE_FLAGS = new Set<string>();

/** Flags whose value is a project-relative path (need traversal/absolute checks). */
const ALLURE_PATH_VALUE_FLAGS = new Set([
  "-o",
  "--output",
  "--config",
  "--known-issues",
  // T206: history JSONL path is project-relative.
  "-h",
  "--history-path"
]);

/** Flags whose value is treated as a free-form non-path token. */
const ALLURE_FREEFORM_VALUE_FLAGS = new Set([
  "--report-name",
  "--name",
  "--max-failures",
  "--min-tests-count",
  "--success-rate",
  "--history-limit",
  "--separator",
  "--group-by"
]);

/**
 * Normalize Allure flag synonyms to a canonical token for duplicate
 * detection. Synonym pairs (`-h` / `--history-path`) must be tracked
 * as a single entity so mixed-form usage triggers `duplicate-flag`.
 * `-o` / `--output` is handled separately via `outputSeen` because it
 * also has the unique-flag-required semantics for `generate`.
 */
function canonicalAllureFlag(arg: string): string {
  if (arg === "-h") return "--history-path";
  if (arg === "--name") return "--report-name";
  return arg;
}

function allureValueFlagsFor(subcommand: string): ReadonlySet<string> {
  switch (subcommand) {
    case "generate":
      return ALLURE_GENERATE_VALUE_FLAGS;
    case "quality-gate":
      return ALLURE_QUALITY_GATE_VALUE_FLAGS;
    case "history":
      return ALLURE_HISTORY_VALUE_FLAGS;
    case "csv":
      return ALLURE_CSV_VALUE_FLAGS;
    case "log":
      return ALLURE_LOG_VALUE_FLAGS;
    case "known-issue":
      return ALLURE_KNOWN_ISSUE_VALUE_FLAGS;
    default:
      return new Set();
  }
}

function allureStandaloneFlagsFor(subcommand: string): ReadonlySet<string> {
  switch (subcommand) {
    case "generate":
      return ALLURE_GENERATE_STANDALONE_FLAGS;
    case "quality-gate":
      return ALLURE_QUALITY_GATE_STANDALONE_FLAGS;
    case "history":
      return ALLURE_HISTORY_STANDALONE_FLAGS;
    case "csv":
      return ALLURE_CSV_STANDALONE_FLAGS;
    case "log":
      return ALLURE_LOG_STANDALONE_FLAGS;
    case "known-issue":
      return ALLURE_KNOWN_ISSUE_STANDALONE_FLAGS;
    default:
      return new Set();
  }
}

/**
 * Args validator for the Allure CLI (Phase 1.2 / T204-2 + T205-1).
 *
 * Workbench builds the entire arg vector itself (no user input flows in),
 * so this validator is conservative — it accepts only the precise shape
 * Workbench will emit, and rejects anything else as a defense-in-depth
 * safeguard against future code changes that accidentally widen the
 * surface.
 *
 * Accepted subcommands and shapes:
 *
 * `generate` (T204):
 *   `generate <results-dir> {-o|--output} <report-dir>
 *                            [--config <path>] [--report-name <name>]`
 *   - exactly one positional results-dir (project-relative)
 *   - required output flag (`-o`/`--output`), single occurrence
 *
 * `quality-gate` (T205):
 *   `quality-gate <results-dir> [--max-failures <n>] [--min-tests-count <n>]
 *                                [--success-rate <n>] [--fast-fail]
 *                                [--known-issues <path>]`
 *   - exactly one positional results-dir (project-relative)
 *   - all flags optional (omitted ones use Allure CLI defaults)
 *
 * `history` (T206):
 *   `history {-h|--history-path} <jsonl> <results-dir> [--history-limit <n>]`
 *   - exactly one positional results-dir (project-relative)
 *   - required history path flag, single occurrence
 *
 * `csv` (T207):
 *   `csv <results-dir> {-o|--output} <csv-file> [--disable-headers]
 *        [--separator <s>] [--known-issues <path>]`
 *
 * `log` (T207):
 *   `log <results-dir> [--group-by <field>] [--all-steps] [--with-trace]`
 *
 * `known-issue` (T207):
 *   `known-issue <results-dir> {-o|--output} <json-file>`
 *
 * Anything else (unknown subcommands, unknown flags, multiple positionals,
 * absolute paths, traversal, NUL bytes, oversized args, duplicate flags)
 * is rejected with a stable code from `CommandArgsValidationCode`.
 *
 * Backward-compat: the old name `validateAllureGenerateArgs` re-exports
 * this function so callers from T204 keep working without renames.
 */
export function validateAllureArgs({
  executableName,
  args
}: {
  executableName: string;
  args: ReadonlyArray<string>;
}): CommandArgsValidationResult {
  if (executableName !== "allure") {
    return argsInvalid(
      "unsupported-executable",
      `Executable '${executableName}' is not supported by the Allure command policy.`
    );
  }

  // Reject empty, NUL, oversized at the per-arg level first.
  for (const arg of args) {
    const valueError = validateArgValue(arg);
    if (!valueError.ok) return valueError;
  }

  // First positional must be one of the allowed subcommands.
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

  // Per-subcommand argument-shape rules.
  const valueFlags = allureValueFlagsFor(subcommand);
  const standaloneFlags = allureStandaloneFlagsFor(subcommand);
  const subcommandLabel = `Allure ${subcommand}`;

  let positionalCount = 0;
  let outputSeen = false;
  let historyPathSeen = false;
  const seenValueFlags = new Set<string>();
  let index = 1;
  while (index < args.length) {
    const arg = args[index]!;
    if (standaloneFlags.has(arg)) {
      index += 1;
      continue;
    }
    if (valueFlags.has(arg)) {
      const value = args[index + 1];
      if (value === undefined || isFlagValue(value)) {
        return argsInvalid("missing-flag-value", `${arg} must be followed by a non-flag value.`);
      }
      // Path-bearing flags must resolve to a project-relative location.
      // Free-form flags (e.g. --report-name, --max-failures) only need
      // the per-arg NUL/length pre-pass and the non-flag-value check.
      if (ALLURE_PATH_VALUE_FLAGS.has(arg)) {
        const operandResult = validateProjectRelativeOperand(value);
        if (!operandResult.ok) return operandResult;
      } else if (!ALLURE_FREEFORM_VALUE_FLAGS.has(arg)) {
        // Defense-in-depth: a flag in `valueFlags` but not classified.
        return argsInvalid(
          "disallowed-flag",
          `Flag '${arg}' is not classified as path or free-form for ${subcommandLabel}.`
        );
      }
      // Duplicate detection. Synonym pairs collapse to a canonical key
      // so mixed-form duplicates (e.g. `-o ... --output ...` or
      // `-h ... --history-path ...`) are still caught.
      if (arg === "-o" || arg === "--output") {
        if (outputSeen) {
          return argsInvalid(
            "duplicate-output-flag",
            `${subcommandLabel} must be invoked with a single output flag.`
          );
        }
        outputSeen = true;
      } else if (arg === "-h" || arg === "--history-path") {
        if (historyPathSeen) {
          return argsInvalid(
            "duplicate-flag",
            `Flag '${arg}' must not appear more than once for the ${subcommandLabel} policy.`
          );
        }
        historyPathSeen = true;
      } else {
        // Normalize known synonym pairs to a single canonical token so
        // mixed-form duplicates trigger duplicate-flag.
        const canonical = canonicalAllureFlag(arg);
        if (seenValueFlags.has(canonical)) {
          return argsInvalid(
            "duplicate-flag",
            `Flag '${arg}' must not appear more than once for the ${subcommandLabel} policy.`
          );
        }
        seenValueFlags.add(canonical);
      }
      index += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      return argsInvalid(
        "disallowed-flag",
        `Flag '${arg}' is not allowed by the ${subcommandLabel} policy.`
      );
    }
    // Positional operand: the results-dir to read from.
    const operandResult = validateProjectRelativeOperand(arg);
    if (!operandResult.ok) return operandResult;
    positionalCount += 1;
    if (positionalCount > 1) {
      return argsInvalid(
        "extra-positional",
        `${subcommandLabel} accepts only one positional results-dir argument.`
      );
    }
    index += 1;
  }

  if (positionalCount !== 1) {
    return argsInvalid(
      "missing-results-dir",
      `${subcommandLabel} must specify a positional results-dir argument.`
    );
  }
  if ((subcommand === "generate" || subcommand === "csv" || subcommand === "known-issue") && !outputSeen) {
    return argsInvalid(
      "missing-output-flag",
      `${subcommandLabel} must specify an explicit output path via -o or --output.`
    );
  }
  if (subcommand === "history" && !historyPathSeen) {
    return argsInvalid(
      "missing-history-path-flag",
      "Allure history must specify an explicit history path via -h or --history-path."
    );
  }

  return argsValid;
}

/** Backward-compat alias for T204 callers. New callers should use
 *  `validateAllureArgs` directly. */
export const validateAllureGenerateArgs = validateAllureArgs;

/**
 * Allure-specific CommandPolicy factory.
 * Used by RunManager when invoking the Allure CLI for HTML report
 * generation (T204) and Quality Gate evaluation (T205). The single
 * policy covers both subcommands because the executable, env
 * allowlist, and cwd boundary are identical — only the argv shape
 * differs, which the validator dispatches internally.
 */
export function createAllureCommandPolicy(cwdBoundary: string): CommandPolicy {
  return {
    allowedExecutables: ["allure"],
    argValidator: validateAllureArgs,
    cwdBoundary: fs.realpathSync(cwdBoundary),
    envAllowlist: DEFAULT_ENV_ALLOWLIST
  };
}

/* ----------------------------------------------------------------- */
/* T500-2: AI CLI 引数検証 policy                                    */
/* ----------------------------------------------------------------- */

const CLAUDE_AI_ARGS = ["--print", "--output-format", "json"] as const;

export function validateAiArgs({
  executableName,
  args
}: {
  executableName: string;
  args: ReadonlyArray<string>;
}): CommandArgsValidationResult {
  if (executableName !== "claude") {
    return argsInvalid(
      "unsupported-executable",
      `Executable '${executableName}' is not supported by the AI command policy.`
    );
  }
  for (const arg of args) {
    const valueError = validateArgValue(arg);
    if (!valueError.ok) return valueError;
  }
  if (args.length !== CLAUDE_AI_ARGS.length) {
    return argsInvalid(
      "invalid-prefix",
      "Claude Code AI analysis must use the approved non-interactive JSON invocation."
    );
  }
  for (let index = 0; index < CLAUDE_AI_ARGS.length; index += 1) {
    if (args[index] !== CLAUDE_AI_ARGS[index]) {
      return argsInvalid(
        "invalid-prefix",
        "Claude Code AI analysis must use the approved non-interactive JSON invocation."
      );
    }
  }
  return argsValid;
}

export function createAiCommandPolicy(cwdBoundary: string): CommandPolicy {
  return {
    allowedExecutables: ["claude"],
    argValidator: validateAiArgs,
    cwdBoundary: fs.realpathSync(cwdBoundary),
    envAllowlist: DEFAULT_ENV_ALLOWLIST
  };
}

/* ----------------------------------------------------------------- */
/* T1500-3: Exploration adapter command policy                       */
/* ----------------------------------------------------------------- */

export function validateExplorationAdapterArgs({
  executableName,
  args
}: {
  executableName: string;
  args: ReadonlyArray<string>;
}): CommandArgsValidationResult {
  if (!["node", "python", "python3"].includes(executableName)) {
    return argsInvalid(
      "unsupported-executable",
      `Executable '${executableName}' is not supported by the exploration adapter policy.`
    );
  }
  if (args.length === 0) {
    return argsInvalid(
      "missing-subcommand",
      "Exploration adapter policy requires a project-relative script path."
    );
  }
  for (const arg of args) {
    const valueError = validateArgValue(arg);
    if (!valueError.ok) return valueError;
    const explorationArgError = validateExplorationArg(arg);
    if (!explorationArgError.ok) return explorationArgError;
  }
  const scriptResult = validateProjectRelativeOperand(args[0] ?? "");
  if (!scriptResult.ok) return scriptResult;

  const extension = path.extname(args[0] ?? "").toLowerCase();
  if (executableName === "node" && ![".js", ".cjs", ".mjs"].includes(extension)) {
    return argsInvalid("disallowed-operand", "Node exploration adapters must be .js, .cjs, or .mjs files.");
  }
  if (["python", "python3"].includes(executableName) && extension !== ".py") {
    return argsInvalid("disallowed-operand", "Python exploration adapters must be .py files.");
  }
  return argsValid;
}

const EXPLORATION_SECRET_ARG_PATTERN =
  /(sk-(?:proj|svcacct)-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|xox[bpoart]-[A-Za-z0-9-]{20,}|(?:api[_-]?key|token|password|secret|credential)\s*[=:])/i;

function validateExplorationArg(arg: string): CommandArgsValidationResult {
  const segments = explorationArgSegments(arg);
  if (
    segments.some(
      (segment) => path.isAbsolute(segment) || segment.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(segment)
    )
  ) {
    return argsInvalid("absolute-path", "Exploration adapter args must not contain absolute paths.");
  }
  if (
    segments.some(
      (segment) => segment.split(/[\\/]/).includes("..") || /(^|[=,])\.\.([\\/]|$)/.test(segment)
    )
  ) {
    return argsInvalid("path-traversal", "Exploration adapter args must not contain traversal segments.");
  }
  if (EXPLORATION_SECRET_ARG_PATTERN.test(arg)) {
    return argsInvalid("disallowed-operand", "Exploration adapter args must not contain inline secrets.");
  }
  return argsValid;
}

function explorationArgSegments(arg: string): string[] {
  return arg.split(/[=,:]/).filter((segment) => segment.length > 0);
}

export function createExplorationCommandPolicy(cwdBoundary: string): CommandPolicy {
  return {
    allowedExecutables: ["node", "python", "python3"],
    argValidator: validateExplorationAdapterArgs,
    cwdBoundary: fs.realpathSync(cwdBoundary),
    envAllowlist: DEFAULT_ENV_ALLOWLIST
  };
}

/* ----------------------------------------------------------------- */
/* T600-1: Git patch API command policy                              */
/* ----------------------------------------------------------------- */

export function validateGitPatchArgs({
  executableName,
  args
}: {
  executableName: string;
  args: ReadonlyArray<string>;
}): CommandArgsValidationResult {
  if (executableName !== "git") {
    return argsInvalid(
      "unsupported-executable",
      `Executable '${executableName}' is not supported by the Git patch policy.`
    );
  }
  for (const arg of args) {
    const valueError = validateArgValue(arg);
    if (!valueError.ok) return valueError;
  }
  if (isAllowedGitApplyShape(args)) return argsValid;
  if (args[0] === "status" && args[1] === "--porcelain" && args[2] === "--") {
    if (args.length === 3) {
      return argsInvalid("disallowed-operand", "git status must receive at least one path.");
    }
    for (const operand of args.slice(3)) {
      const operandResult = validateProjectRelativeOperand(operand);
      if (!operandResult.ok) return operandResult;
    }
    return argsValid;
  }
  return argsInvalid("invalid-prefix", "Git patch policy allows only status and apply shapes.");
}

function isAllowedGitApplyShape(args: ReadonlyArray<string>): boolean {
  const joined = args.join("\u0000");
  return (
    joined === ["apply", "--check", "-"].join("\u0000") ||
    joined === ["apply", "-"].join("\u0000") ||
    joined === ["apply", "--reverse", "-"].join("\u0000")
  );
}

export function createGitPatchCommandPolicy(cwdBoundary: string): CommandPolicy {
  return {
    allowedExecutables: ["git"],
    argValidator: validateGitPatchArgs,
    cwdBoundary: fs.realpathSync(cwdBoundary),
    envAllowlist: DEFAULT_ENV_ALLOWLIST
  };
}
