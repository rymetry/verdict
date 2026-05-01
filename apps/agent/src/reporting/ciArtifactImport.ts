import {
  CiArtifactImportResponseSchema,
  type CiArtifactImportRequest,
  type CiArtifactImportResponse,
  type CiArtifactKind
} from "@pwqa/shared";

export interface ImportCiArtifactsInput {
  runId: string;
  projectId: string;
  request: CiArtifactImportRequest;
}

export function importCiArtifacts(input: ImportCiArtifactsInput): CiArtifactImportResponse {
  const imported: CiArtifactImportResponse["imported"] = [];
  const skipped: CiArtifactImportResponse["skipped"] = [];

  for (const artifact of input.request.artifacts) {
    const kind = classifyArtifactKind(artifact.name);
    if (!kind) {
      skipped.push({
        name: artifact.name,
        url: artifact.url,
        reason: "unsupported-kind"
      });
      continue;
    }
    imported.push({
      name: artifact.name,
      url: artifact.url,
      source: artifact.source ?? "github-actions",
      kind,
      workflowRunId: artifact.workflowRunId,
      sizeBytes: artifact.sizeBytes
    });
  }

  return CiArtifactImportResponseSchema.parse({
    runId: input.runId,
    projectId: input.projectId,
    imported,
    skipped,
    warnings: []
  });
}

export function classifyArtifactKind(name: string): CiArtifactKind | undefined {
  const normalized = name.toLowerCase().replace(/[_\s]+/g, "-");
  if (hasAny(normalized, ["playwright-report", "playwright-html-report"])) {
    return "playwright-report";
  }
  if (hasAny(normalized, ["playwright-results", "test-results", "trace", "traces", "screenshots", "videos"])) {
    return "playwright-results";
  }
  if (hasAny(normalized, ["allure-report", "allure-html-report"])) {
    return "allure-report";
  }
  if (hasAny(normalized, ["allure-results"])) {
    return "allure-results";
  }
  if (hasAny(normalized, ["quality-gate", "qg-result"])) {
    return "quality-gate";
  }
  if (hasAny(normalized, ["qmo-summary", "release-readiness"])) {
    return "qmo-summary";
  }
  if (hasAny(normalized, ["stdout", "stderr", "log", "logs"])) {
    return "log";
  }
  return undefined;
}

function hasAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}
