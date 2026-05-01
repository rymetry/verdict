import {
  ReleaseReviewDraftSchema,
  type CiArtifactLink,
  type GitHubIssueLink,
  type GitHubPullRequestLink,
  type QmoSummary,
  type ReleaseReviewDraft,
  type ReleaseReviewDraftRequest
} from "@pwqa/shared";

export interface BuildReleaseReviewDraftInput {
  qmoSummary: QmoSummary;
  request: ReleaseReviewDraftRequest;
  generatedAt?: string;
}

export function buildReleaseReviewDraft(input: BuildReleaseReviewDraftInput): ReleaseReviewDraft {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const draft = {
    runId: input.qmoSummary.runId,
    projectId: input.qmoSummary.projectId,
    generatedAt,
    outcome: input.qmoSummary.outcome,
    qmoSummary: input.qmoSummary,
    pullRequest: input.request.pullRequest,
    issues: input.request.issues,
    ciArtifacts: input.request.ciArtifacts,
    markdown: renderReleaseReviewMarkdown({
      qmoSummary: input.qmoSummary,
      pullRequest: input.request.pullRequest,
      issues: input.request.issues,
      ciArtifacts: input.request.ciArtifacts,
      generatedAt
    })
  };
  return ReleaseReviewDraftSchema.parse(draft);
}

function renderReleaseReviewMarkdown(input: {
  qmoSummary: QmoSummary;
  pullRequest?: GitHubPullRequestLink;
  issues: GitHubIssueLink[];
  ciArtifacts: CiArtifactLink[];
  generatedAt: string;
}): string {
  const lines: string[] = [];
  lines.push("# Release Readiness Review");
  lines.push("");
  lines.push(`- Outcome: \`${input.qmoSummary.outcome}\``);
  lines.push(`- Run: \`${input.qmoSummary.runId}\``);
  lines.push(`- Project: \`${input.qmoSummary.projectId}\``);
  lines.push(`- Generated: ${input.generatedAt}`);
  lines.push("");
  lines.push("## QMO Summary");
  lines.push("");
  if (input.qmoSummary.testSummary) {
    const t = input.qmoSummary.testSummary;
    lines.push(`- Tests: ${t.passed}/${t.total} passed, ${t.failed} failed, ${t.flaky} flaky`);
  } else {
    lines.push("- Tests: summary unavailable");
  }
  if (input.qmoSummary.qualityGate) {
    const qg = input.qmoSummary.qualityGate;
    lines.push(`- Quality Gate: \`${qg.status}\` (${qg.profile})`);
  } else {
    lines.push("- Quality Gate: not evaluated");
  }
  lines.push("");
  lines.push("## GitHub Context");
  lines.push("");
  if (input.pullRequest) {
    lines.push(`- PR: ${formatPr(input.pullRequest)}`);
  } else {
    lines.push("- PR: not linked");
  }
  if (input.issues.length > 0) {
    for (const issue of input.issues) {
      lines.push(`- Issue: ${formatIssue(issue)}`);
    }
  } else {
    lines.push("- Issues: not linked");
  }
  lines.push("");
  lines.push("## CI Artifacts");
  lines.push("");
  if (input.ciArtifacts.length > 0) {
    for (const artifact of input.ciArtifacts) {
      lines.push(`- ${safeText(artifact.name)} (${artifact.kind}, ${artifact.source}): ${artifact.url}`);
    }
  } else {
    lines.push("- No CI artifacts linked.");
  }
  lines.push("");
  lines.push("## Workbench Artifacts");
  lines.push("");
  if (input.qmoSummary.reportLinks.allureReportDir) {
    lines.push(`- Allure report: \`${input.qmoSummary.reportLinks.allureReportDir}\``);
  }
  if (input.qmoSummary.reportLinks.qualityGateResultPath) {
    lines.push(`- Quality Gate result: \`${input.qmoSummary.reportLinks.qualityGateResultPath}\``);
  }
  if (
    !input.qmoSummary.reportLinks.allureReportDir &&
    !input.qmoSummary.reportLinks.qualityGateResultPath
  ) {
    lines.push("- No Workbench artifact links verified for this run.");
  }
  lines.push("");
  return lines.join("\n");
}

function formatPr(pr: GitHubPullRequestLink): string {
  const title = pr.title ? ` ${safeText(pr.title)}` : "";
  const author = pr.author ? ` by ${safeText(pr.author)}` : "";
  return `${safeText(pr.repository)}#${pr.number}${title}${author} (${pr.url})`;
}

function formatIssue(issue: GitHubIssueLink): string {
  const title = issue.title ? ` ${safeText(issue.title)}` : "";
  const state = issue.state ? ` [${issue.state}]` : "";
  return `${safeText(issue.repository)}#${issue.number}${title}${state} (${issue.url})`;
}

function safeText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}
