import { describe, expect, it } from "vitest";
import { classifyArtifactKind, importCiArtifacts } from "../src/reporting/ciArtifactImport.js";

describe("classifyArtifactKind", () => {
  it.each([
    ["playwright-report", "playwright-report"],
    ["test-results-chromium", "playwright-results"],
    ["allure-report", "allure-report"],
    ["allure-results", "allure-results"],
    ["quality-gate-result", "quality-gate"],
    ["qmo-summary", "qmo-summary"],
    ["stdout-log", "log"]
  ] as const)("classifies %s as %s", (name, kind) => {
    expect(classifyArtifactKind(name)).toBe(kind);
  });

  it("returns undefined for unrelated artifacts", () => {
    expect(classifyArtifactKind("coverage-report")).toBeUndefined();
  });
});

describe("importCiArtifacts", () => {
  it("imports known Playwright and Allure outputs and skips unrelated artifacts", () => {
    const response = importCiArtifacts({
      runId: "run-1",
      projectId: "project-1",
      request: {
        artifacts: [
          {
            name: "playwright-report",
            url: "https://github.com/owner/repo/actions/runs/1/artifacts/10",
            source: "github-actions",
            workflowRunId: 1,
            sizeBytes: 10_000
          },
          {
            name: "allure-results",
            url: "https://github.com/owner/repo/actions/runs/1/artifacts/11",
            source: "github-actions"
          },
          {
            name: "coverage-report",
            url: "https://github.com/owner/repo/actions/runs/1/artifacts/12",
            source: "github-actions"
          }
        ]
      }
    });

    expect(response.imported.map((artifact) => artifact.kind)).toEqual([
      "playwright-report",
      "allure-results"
    ]);
    expect(response.imported[0]).toMatchObject({
      workflowRunId: 1,
      sizeBytes: 10_000
    });
    expect(response.skipped).toEqual([
      {
        name: "coverage-report",
        url: "https://github.com/owner/repo/actions/runs/1/artifacts/12",
        reason: "unsupported-kind"
      }
    ]);
  });
});
