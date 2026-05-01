import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  AllureHistoryEntry,
  FailedTest,
  FailureReviewHistoryEntry,
  FailureReviewKnownIssue,
  FailureReviewResponse,
  FailureReviewTest,
  RunMetadata
} from "@pwqa/shared";
import { readAllureHistory } from "./allureHistoryReader.js";
import { readAllureResults, type AllureResult } from "./allureResultsReader.js";
import { workbenchPaths } from "../storage/paths.js";

const MAX_KNOWN_ISSUES_BYTES = 1024 * 1024;
const FAILURE_STATUSES = new Set(["failed", "broken", "timedOut", "interrupted"]);

interface BuildFailureReviewInput {
  run: RunMetadata;
  projectRoot: string;
}

export async function buildFailureReview(
  input: BuildFailureReviewInput
): Promise<FailureReviewResponse> {
  const warnings: string[] = [...input.run.warnings];
  const { allureHistoryPath, knownIssuesPath } = workbenchPaths(input.projectRoot);
  const [allureResults, history, knownIssues] = await Promise.all([
    readRunAllureResults(input.run.paths.allureResultsDest, warnings),
    readHistory(allureHistoryPath, warnings),
    readKnownIssues(knownIssuesPath, warnings)
  ]);

  const failedTests = (input.run.summary?.failedTests ?? []).map((test) =>
    enrichFailedTest(relativeFailedTest(test, input.projectRoot), allureResults, history, knownIssues)
  );

  if (!input.run.summary) {
    warnings.push("Run summary is not available yet; failure review is incomplete.");
  }

  return {
    runId: input.run.runId,
    projectId: input.run.projectId,
    status: input.run.status,
    completedAt: input.run.completedAt,
    failedTests,
    warnings
  };
}

function relativeFailedTest(test: FailedTest, projectRoot: string): FailedTest {
  const sourcePath = test.absoluteFilePath ?? test.filePath;
  const relative = sourcePath ? projectRelativePath(sourcePath, projectRoot) : undefined;
  const attachments = test.attachments.map((artifact) => {
    // Treat producer-supplied relativePath as tainted; unsafe values are demoted to a basename.
    const artifactRelative =
      projectRelativePath(artifact.relativePath ?? "", projectRoot) ??
      projectRelativePath(artifact.path, projectRoot);
    const artifactDisplay = artifactRelative ?? safeDisplayPath(artifact.path) ?? artifact.label;
    return {
      ...artifact,
      path: artifactDisplay,
      relativePath: artifactDisplay,
      absolutePath: undefined
    };
  });
  return {
    ...test,
    filePath:
      projectRelativePath(test.relativeFilePath ?? "", projectRoot) ??
      relative ??
      safeDisplayPath(test.filePath),
    relativeFilePath:
      projectRelativePath(test.relativeFilePath ?? "", projectRoot) ??
      relative ??
      safeDisplayPath(test.filePath),
    absoluteFilePath: undefined,
    attachments
  };
}

function projectRelativePath(filePath: string, projectRoot: string): string | undefined {
  if (!filePath) return undefined;
  const windowsRelative = windowsProjectRelativePath(filePath, projectRoot);
  if (windowsRelative) return windowsRelative;
  if (!path.isAbsolute(filePath)) {
    const parts = filePath.split(/[\\/]+/);
    if (parts.some((part) => part === "..")) return undefined;
    return parts.filter(Boolean).join("/");
  }
  const relative = path.relative(projectRoot, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  return normalizePath(relative);
}

function safeDisplayPath(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  if (/^[A-Za-z]:[\\/]/.test(filePath)) return basenameAny(filePath);
  if (!path.isAbsolute(filePath)) {
    return filePath.split(/[\\/]+/).some((part) => part === "..")
      ? basenameAny(filePath)
      : normalizePath(filePath);
  }
  return basenameAny(filePath);
}

function normalizePath(filePath: string): string {
  return filePath.split(/[\\/]+/).join("/");
}

function basenameAny(filePath: string): string {
  return normalizePath(filePath).split("/").filter(Boolean).at(-1) ?? filePath;
}

function windowsProjectRelativePath(filePath: string, projectRoot: string): string | undefined {
  if (!/^[A-Za-z]:[\\/]/.test(filePath) || !/^[A-Za-z]:[\\/]/.test(projectRoot)) {
    return undefined;
  }
  const normalizedRoot = normalizePath(projectRoot).replace(/\/+$/, "");
  const normalizedPath = normalizePath(filePath);
  if (normalizedPath.toLowerCase() === normalizedRoot.toLowerCase()) return undefined;
  if (!normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
    return undefined;
  }
  return normalizedPath.slice(normalizedRoot.length + 1);
}

async function readRunAllureResults(
  allureResultsDir: string,
  warnings: string[]
): Promise<AllureResult[]> {
  try {
    const result = await readAllureResults(allureResultsDir);
    warnings.push(...result.warnings.map((w) => `[allure-results] ${w}`));
    return result.results;
  } catch (error) {
    const code = errorCodeOf(error);
    if (code !== "ENOENT") {
      warnings.push(`Allure results could not be read for failure review. code=${code}`);
    }
    return [];
  }
}

async function readHistory(
  historyPath: string,
  warnings: string[]
): Promise<AllureHistoryEntry[]> {
  try {
    const result = await readAllureHistory(historyPath);
    warnings.push(...result.warnings.map((w) => `[allure-history] ${w}`));
    return result.entries;
  } catch (error) {
    warnings.push(`Allure history could not be read for failure review. code=${errorCodeOf(error)}`);
    return [];
  }
}

async function readKnownIssues(
  knownIssuesPath: string,
  warnings: string[]
): Promise<FailureReviewKnownIssue[]> {
  let stat;
  try {
    stat = await fs.stat(knownIssuesPath);
  } catch (error) {
    const code = errorCodeOf(error);
    if (code !== "ENOENT") {
      warnings.push(`Known issues could not be opened. code=${code}`);
    }
    return [];
  }

  if (stat.size > MAX_KNOWN_ISSUES_BYTES) {
    warnings.push(
      `Known issues file exceeds ${MAX_KNOWN_ISSUES_BYTES} bytes; ignored for failure review.`
    );
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(knownIssuesPath, "utf8"));
  } catch (error) {
    warnings.push(`Known issues file is not valid JSON. code=${errorCodeOf(error)}`);
    return [];
  }

  return normalizeKnownIssues(parsed);
}

function enrichFailedTest(
  test: FailedTest,
  allureResults: ReadonlyArray<AllureResult>,
  history: ReadonlyArray<AllureHistoryEntry>,
  knownIssues: ReadonlyArray<FailureReviewKnownIssue>
): FailureReviewTest {
  const matchedAllure = findAllureResult(test, allureResults);
  const keys = identityKeys(test, matchedAllure);
  const historyEntries = historyForTest(history, keys);
  return {
    test,
    history: historyEntries,
    knownIssues: knownIssues.filter((issue) => issueMatches(issue, keys, test)),
    flaky: deriveFlakySignal(historyEntries)
  };
}

function findAllureResult(
  test: FailedTest,
  results: ReadonlyArray<AllureResult>
): AllureResult | undefined {
  return results.find((result) => {
    const resultKeys = identityKeysFromAllure(result);
    return (
      (test.testId ? resultKeys.has(test.testId) : false) ||
      (test.fullTitle ? resultKeys.has(test.fullTitle) : false) ||
      resultKeys.has(test.title)
    );
  });
}

function identityKeys(test: FailedTest, allure: AllureResult | undefined): Set<string> {
  const keys = new Set<string>();
  addKey(keys, test.testId);
  addKey(keys, test.fullTitle);
  addKey(keys, test.title);
  if (allure) {
    for (const key of identityKeysFromAllure(allure)) keys.add(key);
  }
  return keys;
}

function identityKeysFromAllure(result: AllureResult): Set<string> {
  const record = result as Record<string, unknown>;
  const keys = new Set<string>();
  addKey(keys, result.uuid);
  addKey(keys, result.fullName);
  addKey(keys, result.name);
  addKey(keys, stringField(record, "historyId"));
  addKey(keys, stringField(record, "testCaseId"));
  return keys;
}

function historyForTest(
  entries: ReadonlyArray<AllureHistoryEntry>,
  keys: ReadonlySet<string>
): FailureReviewTest["history"] {
  const rows: FailureReviewTest["history"] = [];
  for (const entry of entries) {
    const testResults = (entry as Record<string, unknown>).testResults;
    if (!isRecord(testResults)) continue;
    for (const [id, value] of Object.entries(testResults)) {
      if (!historyResultMatches(id, value, keys)) continue;
      const status = isRecord(value) && typeof value.status === "string" ? value.status : "unknown";
      rows.push({
        generatedAt: entry.generatedAt,
        status,
        runUuid: entry.runUuid,
        reportName: entry.reportName
      });
      break;
    }
  }
  return rows.slice(-10);
}

function historyResultMatches(
  id: string,
  value: unknown,
  keys: ReadonlySet<string>
): boolean {
  if (keys.has(id)) return true;
  if (!isRecord(value)) return false;
  return [
    stringField(value, "historyId"),
    stringField(value, "testCaseId"),
    stringField(value, "uuid"),
    stringField(value, "fullName"),
    stringField(value, "name"),
    stringField(value, "title")
  ].some((candidate) => candidate !== undefined && keys.has(candidate));
}

function issueMatches(
  issue: FailureReviewKnownIssue,
  keys: ReadonlySet<string>,
  test: FailedTest
): boolean {
  return (
    keys.has(issue.id) ||
    (issue.historyId !== undefined && keys.has(issue.historyId)) ||
    (issue.testCaseId !== undefined && keys.has(issue.testCaseId)) ||
    issue.title === test.fullTitle ||
    issue.title === test.title
  );
}

function deriveFlakySignal(
  history: ReadonlyArray<FailureReviewHistoryEntry>
): FailureReviewTest["flaky"] {
  let passedRuns = 0;
  let failedRuns = 0;
  let brokenRuns = 0;
  let skippedRuns = 0;
  for (const entry of history) {
    if (entry.status === "passed") passedRuns += 1;
    else if (entry.status === "broken") brokenRuns += 1;
    else if (entry.status === "skipped") skippedRuns += 1;
    else if (FAILURE_STATUSES.has(entry.status)) failedRuns += 1;
  }
  const recentStatuses = history.map((entry) => entry.status).slice(-5);
  return {
    isCandidate: passedRuns > 0 && failedRuns + brokenRuns > 0,
    passedRuns,
    failedRuns,
    brokenRuns,
    skippedRuns,
    recentStatuses
  };
}

function normalizeKnownIssues(parsed: unknown): FailureReviewKnownIssue[] {
  const candidates = knownIssueCandidates(parsed);
  const issues: FailureReviewKnownIssue[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const raw = candidates[index];
    if (!isRecord(raw)) continue;
    const historyId = stringField(raw, "historyId");
    const testCaseId = stringField(raw, "testCaseId");
    const id =
      stringField(raw, "id") ??
      stringField(raw, "uid") ??
      historyId ??
      testCaseId ??
      stringField(raw, "name") ??
      `known-issue-${index + 1}`;
    issues.push({
      id,
      title: stringField(raw, "title") ?? stringField(raw, "name") ?? stringField(raw, "fullName"),
      message: stringField(raw, "message") ?? stringField(raw, "description"),
      status: stringField(raw, "status"),
      historyId,
      testCaseId
    });
  }
  return issues;
}

function knownIssueCandidates(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!isRecord(parsed)) return [];
  for (const key of ["knownIssues", "knownIssue", "issues", "items", "tests", "testResults"]) {
    const value = parsed[key];
    if (Array.isArray(value)) return value;
  }
  return Object.entries(parsed).map(([key, value]) =>
    isRecord(value) ? { id: key, historyId: key, ...value } : value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function addKey(keys: Set<string>, value: string | undefined): void {
  if (value && value.length > 0) keys.add(value);
}

function errorCodeOf(error: unknown): string {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return error instanceof SyntaxError ? "INVALID_JSON" : "UNKNOWN";
}
