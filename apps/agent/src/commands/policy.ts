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
  | "flag-like-operand";

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
