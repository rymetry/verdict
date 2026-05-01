import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  AiAnalysisContext,
  AiAnalysisFailureContext,
  AiAnalysisLogExcerpt,
  EvidenceArtifact,
  FailedTest,
  FailureReviewResponse,
  FailureReviewTest,
  RunMetadata,
  RunRequest,
  TestResultSummary
} from "@pwqa/shared";
import { redactWithStats } from "../commands/redact.js";

const LOG_TAIL_BYTES = 16 * 1024;
const MAX_TEXT_LENGTH = 8 * 1024;

export interface BuildAiAnalysisContextInput {
  run: RunMetadata;
  failureReview: FailureReviewResponse;
}

export async function buildAiAnalysisContext(
  input: BuildAiAnalysisContextInput
): Promise<AiAnalysisContext> {
  const warnings = [...input.run.warnings, ...input.failureReview.warnings].map((warning) =>
    sanitizeText(warning, input.run.projectRoot)
  );
  return {
    runId: input.run.runId,
    projectId: sanitizeText(input.run.projectId, input.run.projectRoot),
    generatedAt: new Date().toISOString(),
    status: input.run.status,
    command: {
      executable: sanitizeText(input.run.command.executable, input.run.projectRoot),
      args: input.run.command.args.map((arg) => sanitizeText(arg, input.run.projectRoot))
    },
    requested: sanitizeRunRequest(input.run.requested, input.run.projectRoot),
    summary: sanitizeSummary(input.run.summary, input.run.projectRoot),
    failures: input.failureReview.failedTests.map((failure) =>
      toFailureContext(failure, input.run.projectRoot)
    ),
    logs: await readLogExcerpts(input.run),
    warnings
  };
}

function sanitizeRunRequest(request: RunRequest, projectRoot: string): RunRequest {
  return {
    ...request,
    projectId: sanitizeText(request.projectId, projectRoot),
    specPath: sanitizeOptional(request.specPath, projectRoot),
    testIds: request.testIds?.map((testId) => sanitizeText(testId, projectRoot)),
    grep: sanitizeOptional(request.grep, projectRoot),
    projectNames: request.projectNames?.map((projectName) => sanitizeText(projectName, projectRoot))
  };
}

function sanitizeSummary(
  summary: TestResultSummary | undefined,
  projectRoot: string
): TestResultSummary | undefined {
  if (!summary) return undefined;
  return {
    ...summary,
    failedTests: summary.failedTests.map((test) => ({
      ...test,
      testId: sanitizeOptional(test.testId, projectRoot),
      title: sanitizeText(test.title, projectRoot),
      fullTitle: sanitizeOptional(test.fullTitle, projectRoot),
      filePath: projectRelativePath(test.filePath ?? "", projectRoot),
      message: sanitizeOptional(test.message, projectRoot),
      stack: sanitizeOptional(test.stack, projectRoot),
      attachments: test.attachments.map((artifact) => sanitizeArtifact(artifact, projectRoot))
    }))
  };
}

function toFailureContext(
  failure: FailureReviewTest,
  projectRoot: string
): AiAnalysisFailureContext {
  const test = failure.test;
  return {
    testId: sanitizeOptional(test.testId, projectRoot),
    title: sanitizeText(test.title, projectRoot),
    fullTitle: sanitizeOptional(test.fullTitle, projectRoot),
    status: test.status,
    location: locationFor(test, projectRoot),
    message: sanitizeOptional(test.message, projectRoot),
    stack: sanitizeOptional(test.stack, projectRoot),
    attachments: test.attachments.map((artifact) => sanitizeArtifact(artifact, projectRoot)),
    history: failure.history.map((entry) => ({
      generatedAt: entry.generatedAt,
      status: entry.status,
      runUuid: sanitizeOptional(entry.runUuid, projectRoot),
      reportName: sanitizeOptional(entry.reportName, projectRoot)
    })),
    knownIssues: failure.knownIssues.map((issue) => ({
      id: sanitizeText(issue.id, projectRoot),
      title: sanitizeOptional(issue.title, projectRoot),
      message: sanitizeOptional(issue.message, projectRoot),
      status: sanitizeOptional(issue.status, projectRoot),
      historyId: sanitizeOptional(issue.historyId, projectRoot),
      testCaseId: sanitizeOptional(issue.testCaseId, projectRoot)
    })),
    flaky: failure.flaky
  };
}

function locationFor(test: FailedTest, projectRoot: string): AiAnalysisFailureContext["location"] {
  if (!test.filePath) return undefined;
  const relativePath = projectRelativePath(test.filePath, projectRoot);
  if (!relativePath) return undefined;
  return {
    relativePath,
    line: test.line,
    column: test.column
  };
}

function sanitizeArtifact(artifact: EvidenceArtifact, projectRoot: string): EvidenceArtifact {
  const relativePath = projectRelativePath(artifact.path, projectRoot);
  return {
    kind: artifact.kind,
    label: sanitizeText(artifact.label, projectRoot),
    path: relativePath ?? path.basename(artifact.path)
  };
}

async function readLogExcerpts(run: RunMetadata): Promise<AiAnalysisLogExcerpt[]> {
  const [stdout, stderr] = await Promise.all([
    readLogExcerpt("stdout", run.paths.stdoutLog, run.projectRoot),
    readLogExcerpt("stderr", run.paths.stderrLog, run.projectRoot)
  ]);
  return [stdout, stderr].filter((entry): entry is AiAnalysisLogExcerpt => entry !== undefined);
}

async function readLogExcerpt(
  stream: "stdout" | "stderr",
  filePath: string,
  projectRoot: string
): Promise<AiAnalysisLogExcerpt | undefined> {
  let handle: fs.FileHandle | undefined;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return undefined;
    const length = Math.min(stat.size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    handle = await fs.open(filePath, "r");
    await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
    const redacted = redactWithStats(sanitizePathText(buffer.toString("utf8"), projectRoot));
    return {
      stream,
      text: limitText(redacted.value),
      truncated: stat.size > LOG_TAIL_BYTES || redacted.value.length > MAX_TEXT_LENGTH,
      redactions: redacted.replacements
    };
  } catch (error) {
    if (errorCodeOf(error) === "ENOENT") return undefined;
    return {
      stream,
      text: `Log excerpt unavailable. code=${errorCodeOf(error)}`,
      truncated: false,
      redactions: 0
    };
  } finally {
    await handle?.close();
  }
}

function sanitizeOptional(value: string | undefined, projectRoot: string): string | undefined {
  return value === undefined ? undefined : sanitizeText(value, projectRoot);
}

function sanitizeText(value: string, projectRoot: string): string {
  return limitText(redactWithStats(sanitizePathText(value, projectRoot)).value);
}

function sanitizePathText(value: string, projectRoot: string): string {
  const homeDir = os.homedir();
  return value
    .split(projectRoot)
    .join("<projectRoot>")
    .split(homeDir)
    .join("<home>");
}

function limitText(value: string): string {
  return value.length <= MAX_TEXT_LENGTH ? value : value.slice(value.length - MAX_TEXT_LENGTH);
}

function projectRelativePath(filePath: string, projectRoot: string): string | undefined {
  const absolute = path.resolve(filePath);
  const relative = path.relative(projectRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return relative;
}

function errorCodeOf(error: unknown): string {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "UNKNOWN";
}
