import * as path from "node:path";
import {
  type CommandTemplate,
  type DetectedPackageManager,
  type RunRequest
} from "@pwqa/shared";

export interface PlaywrightCommandInput {
  packageManager: DetectedPackageManager;
  request: RunRequest;
  /** Absolute path of the JSON output file, relative to the project root. */
  jsonOutputPath: string;
  /** Absolute path of the HTML report directory. */
  htmlOutputDir: string;
  /** Project root used to compute relative paths. */
  projectRoot: string;
}

const REPORTERS = ["list", "json", "html"] as const;

export class PlaywrightCommandBuildError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "PlaywrightCommandBuildError";
  }
}

export function buildPlaywrightTestCommand(input: PlaywrightCommandInput): {
  command: CommandTemplate;
  env: Record<string, string>;
} {
  const base = input.packageManager.commandTemplates.playwrightTest;
  const args = [...base.args];

  // 追加 reporter は専用 adapter policy で許可し、既定の reporter セットは広げない。
  args.push(`--reporter=${REPORTERS.join(",")}`);

  if (input.request.headed) {
    args.push("--headed");
  }
  for (const projectName of input.request.projectNames ?? []) {
    args.push("--project", projectName);
  }

  // testIds and grep map onto Playwright's --grep, which only honours the last
  // occurrence. Combine them into a single alternation regex.
  const grepFragments: string[] = [];
  if (input.request.grep) {
    grepFragments.push(input.request.grep);
  }
  for (const testId of input.request.testIds ?? []) {
    grepFragments.push(`^${escapeRegex(testId)}$`);
  }
  if (grepFragments.length > 0) {
    args.push("--grep", grepFragments.length === 1 ? grepFragments[0]! : `(${grepFragments.join("|")})`);
  }

  if (input.request.specPath) {
    const specRel = resolveSpecRelative(input.projectRoot, input.request.specPath);
    args.push(specRel);
  }

  // Direct Playwright JSON / HTML reporter outputs into the run dir without
  // editing the user's playwright.config. Workbench leaves user config untouched.
  const env: Record<string, string> = {
    PLAYWRIGHT_JSON_OUTPUT_NAME: input.jsonOutputPath,
    PLAYWRIGHT_HTML_REPORT: input.htmlOutputDir,
    PLAYWRIGHT_HTML_OPEN: "never"
  };

  return {
    command: { executable: base.executable, args },
    env
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Confines `specPath` to the project root. The schema already rejects
 * leading '-', '..' and absolute paths, but we re-check defensively here
 * so the runner cannot be reached with a path that escapes the project.
 */
function resolveSpecRelative(projectRoot: string, specPath: string): string {
  if (specPath.startsWith("-")) {
    throw new PlaywrightCommandBuildError(
      "specPath must not start with '-'",
      "INVALID_SPEC_PATH"
    );
  }
  const absolute = path.resolve(projectRoot, specPath);
  const relative = path.relative(projectRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PlaywrightCommandBuildError(
      `specPath '${specPath}' escapes the project root`,
      "INVALID_SPEC_PATH"
    );
  }
  return relative === "" ? "." : relative;
}
