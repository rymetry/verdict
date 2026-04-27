import * as path from "node:path";
import { type FailedTest, type TestResultSummary } from "@pwqa/shared";

interface PwJsonAttachment {
  name: string;
  path?: string;
  contentType?: string;
}

interface PwJsonResult {
  status: string;
  duration?: number;
  error?: { message?: string; stack?: string };
  errors?: { message?: string; stack?: string }[];
  attachments?: PwJsonAttachment[];
}

interface PwJsonTestEntry {
  id?: string;
  projectName?: string;
  status: string;
  expectedStatus?: string;
  results?: PwJsonResult[];
}

interface PwJsonSpec {
  title: string;
  ok?: boolean;
  file?: string;
  line?: number;
  column?: number;
  tests?: PwJsonTestEntry[];
}

interface PwJsonSuite {
  title?: string;
  file?: string;
  line?: number;
  column?: number;
  specs?: PwJsonSpec[];
  suites?: PwJsonSuite[];
}

interface PwJsonStats {
  expected?: number;
  unexpected?: number;
  flaky?: number;
  skipped?: number;
  duration?: number;
}

interface PwJsonRoot {
  stats?: PwJsonStats;
  suites?: PwJsonSuite[];
  errors?: { message?: string }[];
}

function attachmentKind(name: string, contentType: string | undefined): "log" | "trace" | "screenshot" | "video" | "json" | "html" {
  const lower = name.toLowerCase();
  if (lower.includes("trace")) return "trace";
  if (lower.includes("video")) return "video";
  if (lower.includes("screenshot")) return "screenshot";
  if (contentType?.startsWith("application/json")) return "json";
  if (contentType?.startsWith("text/html")) return "html";
  return "log";
}

function flatten(suite: PwJsonSuite, ancestorTitles: string[]): Array<{ spec: PwJsonSpec; describePath: string[]; suiteFile?: string }> {
  const acc: Array<{ spec: PwJsonSpec; describePath: string[]; suiteFile?: string }> = [];
  const titles = suite.title ? [...ancestorTitles, suite.title] : ancestorTitles;
  for (const spec of suite.specs ?? []) {
    acc.push({ spec, describePath: titles, suiteFile: suite.file });
  }
  for (const child of suite.suites ?? []) {
    acc.push(...flatten(child, titles));
  }
  return acc;
}

function failingResult(test: PwJsonTestEntry): PwJsonResult | undefined {
  return (test.results ?? []).find((result) => result.status === "failed" || result.status === "timedOut");
}

export function summarizePlaywrightJson(
  projectRoot: string,
  raw: string
): { summary: TestResultSummary; warnings: string[] } {
  const warnings: string[] = [];
  let parsed: PwJsonRoot;
  try {
    parsed = JSON.parse(raw) as PwJsonRoot;
  } catch (error) {
    return {
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        flaky: 0,
        failedTests: []
      },
      warnings: [
        `Failed to parse Playwright JSON output: ${
          error instanceof Error ? error.message : String(error)
        }`
      ]
    };
  }

  const stats = parsed.stats ?? {};
  const passed = stats.expected ?? 0;
  const failed = stats.unexpected ?? 0;
  const flaky = stats.flaky ?? 0;
  const skipped = stats.skipped ?? 0;
  const total = passed + failed + flaky + skipped;

  const failedTests: FailedTest[] = [];
  for (const suite of parsed.suites ?? []) {
    for (const { spec, describePath, suiteFile } of flatten(suite, [])) {
      for (const test of spec.tests ?? []) {
        const failingResultEntry = failingResult(test);
        if (!failingResultEntry) continue;
        const file = spec.file ?? suiteFile;
        const error = failingResultEntry.error ?? failingResultEntry.errors?.[0];
        failedTests.push({
          testId: test.id,
          title: spec.title,
          fullTitle: [...describePath, spec.title].join(" > "),
          filePath: file ? (path.isAbsolute(file) ? file : path.join(projectRoot, file)) : undefined,
          line: spec.line,
          column: spec.column,
          status: test.status,
          durationMs: failingResultEntry.duration,
          message: error?.message,
          stack: error?.stack,
          attachments: (failingResultEntry.attachments ?? [])
            .filter((attachment) => Boolean(attachment.path))
            .map((attachment) => ({
              kind: attachmentKind(attachment.name, attachment.contentType),
              path: attachment.path!,
              label: attachment.name
            }))
        });
      }
    }
  }

  return {
    summary: {
      total,
      passed,
      failed,
      skipped,
      flaky,
      durationMs: stats.duration,
      failedTests
    },
    warnings
  };
}
