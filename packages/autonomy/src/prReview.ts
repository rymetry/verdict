import type { ReviewFinding, SubagentReview } from "./ship.js";

export interface DiffReviewInput {
  diff: string;
  reviewer?: string;
}

export interface DiffReviewOutput {
  expectedReviewers: string[];
  reviews: SubagentReview[];
}

interface ParsedDiff {
  files: Set<string>;
  addedLines: Array<{
    file: string;
    line: string;
  }>;
}

const DEFAULT_REVIEWER = "diff-review";

export function reviewPullRequestDiff(input: DiffReviewInput): DiffReviewOutput {
  const reviewer = input.reviewer ?? DEFAULT_REVIEWER;
  const parsed = parseUnifiedDiff(input.diff);
  const findings = [
    ...findStateArtifacts(parsed),
    ...findFocusedTests(parsed),
    ...findSkippedTests(parsed),
    ...findSecretLikeAdditions(parsed),
    ...findAbsolutePathLeaks(parsed),
    ...findMissingTestEvidence(parsed)
  ];
  const blockingFindings = findings.filter((finding) => finding.priority <= 2);
  const review: SubagentReview = {
    reviewer,
    status: blockingFindings.length > 0 ? "fail" : "pass",
    findings,
    summary: `Reviewed ${parsed.files.size} changed files; found ${findings.length} findings, ${blockingFindings.length} blocking.`
  };
  return {
    expectedReviewers: [reviewer],
    reviews: [review]
  };
}

function parseUnifiedDiff(diff: string): ParsedDiff {
  const files = new Set<string>();
  const addedLines: ParsedDiff["addedLines"] = [];
  let currentFile = "unknown";
  for (const line of diff.split("\n")) {
    const fileMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[2] ?? fileMatch[1] ?? "unknown";
      files.add(currentFile);
      continue;
    }
    if (!line.startsWith("+") || line.startsWith("+++")) {
      continue;
    }
    addedLines.push({ file: currentFile, line: line.slice(1) });
  }
  return { files, addedLines };
}

function findStateArtifacts(diff: ParsedDiff): ReviewFinding[] {
  return [...diff.files]
    .filter((file) => file.startsWith(".agents/state/"))
    .map((file) => ({
      priority: 1,
      title: "Agent state artifact is part of the PR",
      body: `${file} is runtime state and should not be committed to a reusable autonomy foundation.`
    }));
}

function findFocusedTests(diff: ParsedDiff): ReviewFinding[] {
  return diff.addedLines
    .filter(({ line }) => /\b(describe|it|test)\.only\s*\(/.test(line))
    .map(({ file }) => ({
      priority: 1,
      title: "Focused test was committed",
      body: `${file} adds .only(), which can hide the rest of the test suite in CI.`
    }));
}

function findSkippedTests(diff: ParsedDiff): ReviewFinding[] {
  return diff.addedLines
    .filter(({ line }) => /\b(describe|it|test)\.skip\s*\(/.test(line))
    .map(({ file }) => ({
      priority: 2,
      title: "Skipped test was added",
      body: `${file} adds .skip(). Confirm this is intentionally non-blocking before shipping.`
    }));
}

function findSecretLikeAdditions(diff: ParsedDiff): ReviewFinding[] {
  return diff.addedLines
    .filter(({ line }) => {
      const value = line.trim();
      return (
        /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/i.test(value) ||
        /\b(sk_live_[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{20,})\b/.test(value)
      );
    })
    .map(({ file }) => ({
      priority: 0,
      title: "Potential secret was added",
      body: `${file} adds a token-like value. Remove it and rotate the credential if it is real.`
    }));
}

function findAbsolutePathLeaks(diff: ParsedDiff): ReviewFinding[] {
  return diff.addedLines
    .filter(({ line }) => /\/Users\/[A-Za-z0-9._-]+\/[^\s"'`)]+/.test(line))
    .map(({ file }) => ({
      priority: 1,
      title: "Absolute local path was added",
      body: `${file} adds a local user-home absolute path. Store repo-relative paths in reusable autonomy artifacts.`
    }));
}

function findMissingTestEvidence(diff: ParsedDiff): ReviewFinding[] {
  const files = [...diff.files];
  const sourceChanged = files.some((file) => file.startsWith("packages/autonomy/src/"));
  const testsChanged = files.some((file) => file.startsWith("packages/autonomy/test/"));
  if (!sourceChanged || testsChanged) {
    return [];
  }
  return [
    {
      priority: 3,
      title: "Autonomy source changed without focused tests",
      body: "No packages/autonomy/test changes were detected. This may be fine for wiring-only changes, but reviewers should confirm coverage."
    }
  ];
}
