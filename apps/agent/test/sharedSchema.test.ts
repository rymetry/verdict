import { describe, expect, it } from "vitest";
import {
  AiAnalysisContextSchema,
  AiAnalysisOutputSchema,
  AiTestGenerationOutputSchema,
  AiTestGenerationContextSchema,
  AiTestGenerationRequestSchema,
  AiTestGenerationResponseSchema,
  AuthSetupRiskSchema,
  CiArtifactImportRequestSchema,
  CiArtifactImportResponseSchema,
  CiArtifactLinkSchema,
  ExplorationScreenModelDraftSchema,
  GitHubPullRequestLinkSchema,
  PlaywrightLaunchCommandRequestSchema,
  PlaywrightLaunchCommandResponseSchema,
  QaTestMetadataSchema,
  ReleaseReviewDraftRequestSchema,
  RunCompletedPayloadSchema,
  RunCancelledPayloadSchema,
  RunErrorPayloadSchema,
  RunListItemSchema,
  ProjectConfigSummarySchema,
  RunRequestSchema,
  RunQueuedPayloadSchema,
  RunStartedPayloadSchema,
  SnapshotPayloadSchema,
  TestCaseSchema,
  TestCodeSignalSchema,
  WorkbenchConfigSchema,
  WorkbenchContextSchema,
  WorkbenchHookSpecSchema,
  WorkbenchSkillSchema,
  WorkbenchEventSchema,
  terminalStatusMatchesEvent
} from "@pwqa/shared";

describe("shared run warning schemas", () => {
  it("validates workbench loader schemas with project-relative paths", () => {
    expect(
      WorkbenchSkillSchema.parse({
        name: "payment-flow",
        relativePath: ".workbench/skills/payment-flow/SKILL.md",
        frontmatter: { title: "Payment Flow" },
        content: "# Payment Flow\n"
      }).name
    ).toBe("payment-flow");

    expect(
      WorkbenchHookSpecSchema.parse({
        name: "pre-generate",
        relativePath: ".workbench/hooks/pre-generate.sh",
        extension: "sh",
        content: "#!/bin/sh\n"
      }).extension
    ).toBe("sh");

    expect(
      WorkbenchContextSchema.parse({
        skills: [],
        rules: [],
        hooks: [],
        intents: [],
        prompts: []
      }).skills
    ).toEqual([]);

    expect(
      WorkbenchConfigSchema.parse({
        version: "0.1",
        exploration: {
          defaultProvider: "custom-browser-driver",
          providers: [
            {
              name: "custom-browser-driver",
              command: { executable: "node", args: ["scripts/explore.mjs"] }
            }
          ]
        }
      }).exploration
    ).toMatchObject({
      defaultProvider: "custom-browser-driver",
      fallbackProviders: ["browser-use"],
      maxAttempts: 2
    });

    expect(
      ExplorationScreenModelDraftSchema.parse({
        startUrl: "https://example.test",
        provider: "custom-browser-driver",
        generatedAt: "2026-05-02T00:00:00.000Z",
        steps: [],
        observedFlows: [],
        unclear: [],
        warnings: []
      }).provider
    ).toBe("custom-browser-driver");

    expect(() =>
      WorkbenchSkillSchema.parse({
        name: "bad",
        relativePath: "/tmp/project/.workbench/skills/bad/SKILL.md",
        frontmatter: {},
        content: "# Bad\n"
      })
    ).toThrow();
    expect(() =>
      WorkbenchConfigSchema.parse({
        version: "0.1",
        exploration: {
          providers: [
            {
              name: "stagehand",
              command: { executable: "/tmp/stagehand", args: [] }
            }
          ]
        }
      })
    ).toThrow();
    expect(() =>
      WorkbenchConfigSchema.parse({
        version: "0.1",
        exploration: {
          providers: [
            {
              name: "stagehand",
              command: { executable: "node", args: ["scripts/explore.mjs", "--state=/etc/passwd"] }
            }
          ]
        }
      })
    ).toThrow();
    expect(() =>
      WorkbenchConfigSchema.parse({
        version: "0.1",
        exploration: {
          providers: [
            {
              name: "stagehand",
              command: { executable: "node", args: ["scripts/explore.mjs", "\\\\server\\share\\state.json"] }
            }
          ]
        }
      })
    ).toThrow();
    expect(() =>
      WorkbenchConfigSchema.parse({
        version: "0.1",
        exploration: {
          providers: [
            {
              name: "stagehand",
              command: {
                executable: "node",
                args: ["scripts/explore.mjs", "--api-key=sk-proj-abcdefghijklmnopqrstuvwxyz"]
              }
            }
          ]
        }
      })
    ).toThrow();
    expect(() =>
      WorkbenchConfigSchema.parse({
        version: "0.1",
        exploration: {
          providers: [
            { name: "stagehand", command: { executable: "node", args: ["a.mjs"] } },
            { name: "stagehand", command: { executable: "node", args: ["b.mjs"] } }
          ]
        }
      })
    ).toThrow();
  });

  it("validates RunRequest retries and workers controls", () => {
    expect(
      RunRequestSchema.parse({
        projectId: "project-1",
        headed: true,
        projectNames: ["chromium"],
        retries: 1,
        workers: 2
      })
    ).toEqual({
      projectId: "project-1",
      headed: true,
      projectNames: ["chromium"],
      retries: 1,
      workers: 2
    });
    expect(() => RunRequestSchema.parse({ projectId: "project-1", retries: -1 })).toThrow();
    expect(() => RunRequestSchema.parse({ projectId: "project-1", workers: 0 })).toThrow();
  });

  it("validates safe Playwright launch command requests and responses", () => {
    expect(
      PlaywrightLaunchCommandRequestSchema.parse({
        kind: "trace-viewer",
        tracePath: "test-results/trace.zip"
      })
    ).toEqual({
      kind: "trace-viewer",
      tracePath: "test-results/trace.zip"
    });
    expect(
      PlaywrightLaunchCommandResponseSchema.parse({
        projectId: "p1",
        kind: "ui-mode",
        command: { executable: "pnpm", args: ["exec", "playwright", "test", "--ui"] },
        warnings: []
      }).kind
    ).toBe("ui-mode");
    expect(() =>
      PlaywrightLaunchCommandRequestSchema.parse({
        kind: "trace-viewer",
        tracePath: "../trace.zip"
      })
    ).toThrow();
    expect(() =>
      PlaywrightLaunchCommandRequestSchema.parse({
        kind: "codegen",
        codegenUrl: "file:///tmp/index.html"
      })
    ).toThrow();
    expect(() =>
      PlaywrightLaunchCommandRequestSchema.parse({
        kind: "ui-mode",
        codegenUrl: "https://example.com"
      })
    ).toThrow();
  });

  it("validates auth setup risk signals on config summaries", () => {
    expect(
      AuthSetupRiskSchema.parse({
        signal: "storage-state-path",
        severity: "warning",
        message: "storageState file path is configured.",
        relativePath: "playwright/.auth/user.json",
        source: "heuristic"
      }).signal
    ).toBe("storage-state-path");

    expect(
      ProjectConfigSummarySchema.parse({
        projectId: "p1",
        generatedAt: "2026-05-01T00:00:00.000Z",
        config: { format: "ts" },
        reporters: [],
        useOptions: [],
        fixtureFiles: [],
        pomFiles: [
          {
            relativePath: "pages/checkout.page.ts",
            kind: "page-object",
            classNames: ["CheckoutPage"],
            locatorCount: 1,
            locatorSamples: [
              {
                value: "this.page.getByRole('button', { name: 'Pay' })",
                line: 12,
                source: "heuristic"
              }
            ],
            sizeBytes: 128
          }
        ],
        warnings: []
      }).authRisks
    ).toEqual([]);
  });

  it("validates QA inventory metadata on test cases", () => {
    expect(
      QaTestMetadataSchema.parse({
        purpose: "checkout > completes purchase",
        steps: [{ title: "Fill cart", line: 12 }],
        expectations: [{ title: "Order confirmation is visible" }],
        source: "static-analysis",
        confidence: "medium"
      })
    ).toEqual({
      purpose: "checkout > completes purchase",
      steps: [{ title: "Fill cart", line: 12 }],
      expectations: [{ title: "Order confirmation is visible" }],
      source: "static-analysis",
      confidence: "medium"
    });

    expect(
      TestCodeSignalSchema.parse({
        kind: "locator",
        value: "page.getByRole('button', { name: 'Pay' })",
        line: 14,
        source: "static-analysis"
      }).kind
    ).toBe("locator");

    expect(() =>
      TestCaseSchema.parse({
        id: "t1",
        title: "completes purchase",
        fullTitle: "checkout > completes purchase",
        filePath: "/repo/tests/checkout.spec.ts",
        relativePath: "tests/checkout.spec.ts",
        line: 12,
        column: 0,
        describePath: ["checkout"],
        tags: [],
        qaMetadata: {
          purpose: "checkout > completes purchase",
          steps: [],
          expectations: [],
          source: "unknown-source",
          confidence: "low"
        },
        codeSignals: [
          {
            kind: "assertion",
            value: "await expect(page).toHaveURL(/done/);",
            line: 20,
            source: "static-analysis"
          }
        ]
      })
    ).toThrow();
  });

  it("preserves warnings in terminal payloads and run list items", () => {
    const warnings = [
      "stdout log write failed; websocket stream was still delivered. code=ENOSPC; failures=1"
    ];

    expect(
      RunCompletedPayloadSchema.parse({
        exitCode: 0,
        signal: null,
        status: "passed",
        durationMs: 123,
        warnings
      }).warnings
    ).toEqual(warnings);

    expect(
      RunCancelledPayloadSchema.parse({
        exitCode: null,
        signal: "SIGTERM",
        status: "cancelled",
        durationMs: 123,
        warnings
      }).warnings
    ).toEqual(warnings);

    expect(
      RunErrorPayloadSchema.parse({
        message: "Runner failed after spawn.",
        exitCode: null,
        signal: null,
        status: "error",
        durationMs: 123,
        warnings
      }).warnings
    ).toEqual(warnings);

    expect(
      RunListItemSchema.parse({
        runId: "r1",
        projectId: "p1",
        status: "passed",
        startedAt: "2026-04-28T00:00:00Z",
        completedAt: "2026-04-28T00:00:01Z",
        durationMs: 123,
        exitCode: 0,
        warnings
      }).warnings
    ).toEqual(warnings);
  });

  it("defaults omitted warnings to [] for backward-compatible event parsing", () => {
    expect(
      RunCompletedPayloadSchema.parse({
        exitCode: 0,
        signal: null,
        status: "passed",
        durationMs: 123
      }).warnings
    ).toEqual([]);

    expect(
      RunErrorPayloadSchema.parse({
        message: "Runner failed after spawn.",
        exitCode: null,
        signal: null,
        status: "error",
        durationMs: 123
      }).warnings
    ).toEqual([]);
  });

  it("requires run.error payloads to include a safe message", () => {
    expect(() =>
      RunErrorPayloadSchema.parse({
        exitCode: null,
        signal: null,
        status: "error",
        durationMs: 123
      })
    ).toThrow();
  });

  it("does not allow success or failure statuses in run.error payloads", () => {
    expect(() =>
      RunErrorPayloadSchema.parse({
        message: "invalid",
        exitCode: 0,
        signal: null,
        status: "passed",
        durationMs: 123,
        warnings: []
      })
    ).toThrow();
  });

  it("does not allow terminal event statuses to cross schema boundaries", () => {
    expect(() =>
      RunCompletedPayloadSchema.parse({
        exitCode: null,
        signal: null,
        status: "error",
        durationMs: 123,
        warnings: []
      })
    ).toThrow();

    expect(() =>
      RunCancelledPayloadSchema.parse({
        exitCode: 0,
        signal: null,
        status: "passed",
        durationMs: 123,
        warnings: []
      })
    ).toThrow();
  });

  it("round-trips non-terminal event payload schemas", () => {
    expect(
      RunQueuedPayloadSchema.parse({
        request: { projectId: "project-1", headed: false }
      })
    ).toEqual({ request: { projectId: "project-1", headed: false } });

    expect(
      RunStartedPayloadSchema.parse({
        command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
        cwd: "/tmp/project",
        startedAt: "2026-04-28T00:00:00.000Z"
      })
    ).toEqual({
      command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
      cwd: "/tmp/project",
      startedAt: "2026-04-28T00:00:00.000Z"
    });

    expect(
      SnapshotPayloadSchema.parse({
        service: "playwright-workbench-agent",
        version: "0.1.0"
      })
    ).toEqual({
      service: "playwright-workbench-agent",
      version: "0.1.0"
    });
  });

  it("validates run.started cwd and timestamp strictly", () => {
    expect(() =>
      RunStartedPayloadSchema.parse({
        command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
        cwd: "relative/project",
        startedAt: "2026-04-28T00:00:00.000Z"
      })
    ).toThrow(/absolute path/);

    expect(() =>
      RunStartedPayloadSchema.parse({
        command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
        cwd: "/tmp/project",
        startedAt: "not-a-date"
      })
    ).toThrow();
  });

  it("accepts only structured cancellation reasons", () => {
    expect(
      RunCancelledPayloadSchema.parse({
        exitCode: null,
        signal: "SIGTERM",
        status: "cancelled",
        cancelReason: "user-request",
        durationMs: 123,
        warnings: []
      }).cancelReason
    ).toBe("user-request");

    expect(() =>
      RunCancelledPayloadSchema.parse({
        exitCode: null,
        signal: "SIGTERM",
        status: "cancelled",
        cancelReason: "/private/raw reason",
        durationMs: 123,
        warnings: []
      })
    ).toThrow();
  });

  it("keeps terminal event and status mapping in shared code", () => {
    expect(terminalStatusMatchesEvent("run.completed", "passed")).toBe(true);
    expect(terminalStatusMatchesEvent("run.completed", "failed")).toBe(true);
    expect(terminalStatusMatchesEvent("run.completed", "error")).toBe(false);
    expect(terminalStatusMatchesEvent("run.cancelled", "cancelled")).toBe(true);
    expect(terminalStatusMatchesEvent("run.error", "error")).toBe(true);
  });

  it("rejects mismatched event type and payload combinations at the envelope boundary", () => {
    expect(() =>
      WorkbenchEventSchema.parse({
        type: "run.completed",
        sequence: 1,
        timestamp: "2026-04-28T00:00:00.000Z",
        runId: "run-1",
        payload: {
          message: "invalid combination",
          exitCode: null,
          signal: null,
          status: "error",
          durationMs: 1,
          warnings: []
        }
      })
    ).toThrow();
  });

  it("requires runId for run events but not for snapshot events", () => {
    expect(() =>
      WorkbenchEventSchema.parse({
        type: "run.stdout",
        sequence: 1,
        timestamp: "2026-04-28T00:00:00.000Z",
        payload: { chunk: "hello" }
      })
    ).toThrow(/runId/);

    expect(
      WorkbenchEventSchema.parse({
        type: "snapshot",
        sequence: 0,
        timestamp: "2026-04-28T00:00:00.000Z",
        payload: { service: "playwright-workbench-agent", version: "0.1.0" }
      })
    ).toEqual({
      type: "snapshot",
      sequence: 0,
      timestamp: "2026-04-28T00:00:00.000Z",
      payload: { service: "playwright-workbench-agent", version: "0.1.0" }
    });
  });

  it("rejects non-ISO timestamp in event envelope", () => {
    expect(() =>
      WorkbenchEventSchema.parse({
        type: "run.stdout",
        runId: "run-1",
        sequence: 1,
        timestamp: "not-a-date",
        payload: { chunk: "hello" }
      })
    ).toThrow();
  });
});

describe("shared AI analysis schemas", () => {
  it("accepts the minimal redacted AI analysis context", () => {
    const parsed = AiAnalysisContextSchema.parse({
      runId: "run-1",
      projectId: "project-1",
      generatedAt: "2026-05-01T00:00:00.000Z",
      status: "failed",
      command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
      requested: { projectId: "project-1", headed: false },
      failures: [
        {
          title: "checkout fails",
          status: "failed",
          attachments: [],
          history: [],
          knownIssues: [],
          flaky: {
            isCandidate: false,
            passedRuns: 0,
            failedRuns: 0,
            brokenRuns: 0,
            skippedRuns: 0,
            recentStatuses: []
          }
        }
      ],
      logs: [{ stream: "stderr", text: "expected error", truncated: false, redactions: 0 }],
      warnings: []
    });

    expect(parsed.failures[0]?.title).toBe("checkout fails");
  });

  it("validates AI analysis output for the adapter boundary", () => {
    expect(
      AiAnalysisOutputSchema.parse({
        classification: "test-bug",
        rootCause: "Assertion no longer matches the product text.",
        evidence: ["stderr shows the assertion failure"],
        risk: ["Patch touches one spec file"],
        filesTouched: ["tests/example.spec.ts"],
        confidence: 0.72,
        requiresHumanDecision: true
      }).classification
    ).toBe("test-bug");
  });
});

describe("shared AI test generation schemas", () => {
  it("defaults provider, mode, and target files for generation requests", () => {
    const request = AiTestGenerationRequestSchema.parse({
      objective: "Add coverage for checkout retries."
    });

    expect(request.provider).toBe("claude-code");
    expect(request.mode).toBe("generator");
    expect(request.targetFiles).toEqual([]);
  });

  it("rejects unsafe target file paths", () => {
    expect(() =>
      AiTestGenerationRequestSchema.parse({
        objective: "invalid",
        targetFiles: ["../secret.spec.ts"]
      })
    ).toThrow(/target file/);

    expect(() =>
      AiTestGenerationRequestSchema.parse({
        objective: "invalid",
        targetFiles: ["/tmp/secret.spec.ts"]
      })
    ).toThrow(/project-relative/);

    expect(() =>
      AiTestGenerationRequestSchema.parse({
        objective: "invalid",
        targetFiles: ["C:\\tmp\\secret.spec.ts"]
      })
    ).toThrow(/project-relative/);

    expect(() =>
      AiTestGenerationRequestSchema.parse({
        objective: "invalid",
        targetFiles: ["\\\\server\\share\\secret.spec.ts"]
      })
    ).toThrow(/project-relative/);
  });

  it("validates generation outputs and responses", () => {
    const result = AiTestGenerationOutputSchema.parse({
      plan: ["Add a retry test"],
      proposedPatch: "diff --git a/tests/example.spec.ts b/tests/example.spec.ts\n",
      filesTouched: ["tests/example.spec.ts"],
      evidence: ["failure review shows checkout retry gap"],
      risk: ["test-only change"],
      confidence: 0.7,
      requiresHumanDecision: false
    });
    expect(result.filesTouched).toEqual(["tests/example.spec.ts"]);

    expect(
      AiTestGenerationResponseSchema.parse({
        runId: "run-1",
        projectId: "project-1",
        provider: "claude-code",
        mode: "generator",
        generatedAt: "2026-05-01T00:00:00.000Z",
        result,
        warnings: []
      }).mode
    ).toBe("generator");
  });

  it("accepts workbench context in generation context", () => {
    const context = AiTestGenerationContextSchema.parse({
      mode: "generator",
      objective: "Generate coverage for checkout.",
      targetFiles: ["tests/generated.spec.ts"],
      analysisContext: baseAiAnalysisContext(),
      workbenchContext: {
        agents: {
          relativePath: ".workbench/AGENTS.md",
          content: "Project context"
        },
        rules: [
          {
            name: "locator-policy",
            relativePath: ".workbench/rules/locator-policy.md",
            frontmatter: { appliesTo: ["e2e"] },
            content: "Prefer role locators."
          }
        ],
        skills: [],
        hooks: [
          {
            name: "pre-generate",
            relativePath: ".workbench/hooks/pre-generate.sh",
            extension: "sh",
            content: "echo policy"
          }
        ],
        prompts: [],
        warnings: []
      }
    });

    expect(context.workbenchContext?.rules[0]?.name).toBe("locator-policy");
  });
});

function baseAiAnalysisContext() {
  return {
    runId: "run-1",
    projectId: "project-1",
    generatedAt: "2026-05-01T00:00:00.000Z",
    status: "failed",
    command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
    requested: { projectId: "project-1", headed: false },
    failures: [],
    logs: [],
    warnings: []
  };
}

describe("shared release review schemas", () => {
  it("accepts GitHub and CI artifact draft links with HTTP URLs", () => {
    expect(
      ReleaseReviewDraftRequestSchema.parse({
        pullRequest: {
          repository: "owner/repo",
          number: 10,
          url: "https://github.com/owner/repo/pull/10"
        },
        issues: [],
        ciArtifacts: [
          {
            name: "allure-report",
            kind: "allure-report",
            source: "github-actions",
            url: "https://github.com/owner/repo/actions/runs/1/artifacts/2"
          }
        ]
      }).ciArtifacts[0]?.kind
    ).toBe("allure-report");
  });

  it("rejects non-HTTP URLs at the review draft boundary", () => {
    expect(() =>
      GitHubPullRequestLinkSchema.parse({
        repository: "owner/repo",
        number: 10,
        url: "file:///tmp/report"
      })
    ).toThrow(/http or https/);

    expect(() =>
      CiArtifactLinkSchema.parse({
        name: "local",
        kind: "other",
        source: "external",
        url: "javascript:alert(1)"
      })
    ).toThrow(/http or https/);
  });

  it("validates imported CI artifact response shapes", () => {
    const request = CiArtifactImportRequestSchema.parse({
      artifacts: [
        {
          name: "playwright-report",
          url: "https://github.com/owner/repo/actions/runs/1/artifacts/2"
        }
      ]
    });
    expect(request.artifacts[0]?.source).toBe("github-actions");

    expect(
      CiArtifactImportResponseSchema.parse({
        runId: "run-1",
        projectId: "project-1",
        imported: [
          {
            name: "playwright-report",
            url: "https://github.com/owner/repo/actions/runs/1/artifacts/2",
            source: "github-actions",
            kind: "playwright-report"
          }
        ],
        skipped: [
          {
            name: "coverage",
            url: "https://github.com/owner/repo/actions/runs/1/artifacts/3",
            reason: "unsupported-kind"
          }
        ],
        warnings: []
      }).imported[0]?.kind
    ).toBe("playwright-report");
  });
});
