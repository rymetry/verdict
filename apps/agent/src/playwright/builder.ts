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

export function buildPlaywrightTestCommand(input: PlaywrightCommandInput): {
  command: CommandTemplate;
  env: Record<string, string>;
} {
  const base = input.packageManager.commandTemplates.playwrightTest;
  const args = [...base.args];

  // PoC §21: list / json / html reporters by default. allure-playwright is added in Phase 1.2.
  const reporterArg = `--reporter=${REPORTERS.join(",")}`;
  args.push(reporterArg);

  if (input.request.headed) {
    args.push("--headed");
  }
  if (input.request.grep) {
    args.push("--grep", input.request.grep);
  }
  for (const projectName of input.request.projectNames ?? []) {
    args.push("--project", projectName);
  }
  for (const testId of input.request.testIds ?? []) {
    // Playwright >=1.55 exposes test IDs via --test-list. PoC fallback: rely on grep when IDs are absent.
    args.push("--grep", `^${escapeRegex(testId)}$`);
  }
  if (input.request.specPath) {
    const specRel = path.isAbsolute(input.request.specPath)
      ? path.relative(input.projectRoot, input.request.specPath)
      : input.request.specPath;
    args.push(specRel);
  }

  // Direct Playwright JSON / HTML reporter outputs into the run dir without
  // editing the user's playwright.config. Workbench leaves user config untouched.
  const env: Record<string, string> = {
    PLAYWRIGHT_JSON_OUTPUT_NAME: input.jsonOutputPath,
    PLAYWRIGHT_HTML_REPORT: input.htmlOutputDir,
    // Disable the auto-open behaviour of the HTML reporter on PoC.
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
