import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CiArtifactImportResponse, QmoSummary, ReleaseReviewDraft } from "@pwqa/shared";

import { ReleaseReviewDraftPanel } from "@/features/release-review-draft/ReleaseReviewDraftPanel";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    createReleaseReviewDraft: vi.fn(),
    importCiArtifacts: vi.fn()
  };
});
import { createReleaseReviewDraft, importCiArtifacts } from "@/api/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.mocked(createReleaseReviewDraft).mockReset();
  vi.mocked(importCiArtifacts).mockReset();
});

function renderPanel(props: {
  summary: QmoSummary | null | undefined;
  isError?: boolean;
  isEmpty?: boolean;
}): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <ReleaseReviewDraftPanel
        summary={props.summary}
        isError={props.isError ?? false}
        isEmpty={props.isEmpty ?? false}
      />
    </QueryClientProvider>
  );
}

describe("ReleaseReviewDraftPanel", () => {
  it("renders nothing while latest QMO summary is still loading", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <ReleaseReviewDraftPanel summary={undefined} isError={false} isEmpty={false} />
      </QueryClientProvider>
    );
    expect(container.firstChild).toBeNull();
  });

  it("does not expose generate action when QMO summary is unavailable", () => {
    renderPanel({ summary: null });

    expect(screen.getByTestId("release-review-draft-pending")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Generate draft/ })).not.toBeInTheDocument();
  });

  it("generates markdown with PR Issue and imported CI artifact context", async () => {
    vi.mocked(importCiArtifacts).mockResolvedValue(makeImportResponse());
    vi.mocked(createReleaseReviewDraft).mockResolvedValue(makeDraft());
    renderPanel({ summary: makeSummary() });

    await userEvent.type(screen.getByLabelText("PR URL"), "https://github.com/owner/repo/pull/42");
    await userEvent.type(screen.getByLabelText("PR repository"), "owner/repo");
    await userEvent.type(screen.getByLabelText("PR number"), "42");
    await userEvent.type(screen.getByLabelText("PR title"), "Release smoke");
    await userEvent.type(screen.getByLabelText("PR author"), "qa-lead");
    await userEvent.type(screen.getByLabelText("Issue URL"), "https://github.com/owner/repo/issues/7");
    await userEvent.type(screen.getByLabelText("Issue repository"), "owner/repo");
    await userEvent.type(screen.getByLabelText("Issue number"), "7");
    await userEvent.type(screen.getByLabelText("Issue title"), "Known checkout issue");
    await userEvent.type(screen.getByLabelText("CI artifact"), "allure-report");
    await userEvent.type(
      screen.getByLabelText("CI artifact URL"),
      "https://github.com/owner/repo/actions/runs/1/artifacts/2"
    );
    await userEvent.click(screen.getByRole("button", { name: /Generate draft/ }));

    expect(await screen.findByLabelText("Release review markdown")).toHaveValue(
      "# Release Readiness Review\n\n- Outcome: `ready`\n"
    );
    expect(screen.getByTestId("release-review-draft-imported")).toHaveTextContent("1");
    expect(vi.mocked(importCiArtifacts)).toHaveBeenCalledWith("run-1", {
      artifacts: [
        {
          name: "allure-report",
          url: "https://github.com/owner/repo/actions/runs/1/artifacts/2",
          source: "github-actions"
        }
      ]
    });
    expect(vi.mocked(createReleaseReviewDraft)).toHaveBeenCalledWith("run-1", {
      pullRequest: {
        url: "https://github.com/owner/repo/pull/42",
        repository: "owner/repo",
        number: 42,
        title: "Release smoke",
        author: "qa-lead"
      },
      issues: [
        {
          url: "https://github.com/owner/repo/issues/7",
          repository: "owner/repo",
          number: 7,
          state: "open",
          title: "Known checkout issue"
        }
      ],
      ciArtifacts: [
        {
          name: "allure-report",
          url: "https://github.com/owner/repo/actions/runs/1/artifacts/2",
          source: "github-actions",
          kind: "allure-report"
        }
      ]
    });
  });

  it("generates a draft without CI import when CI artifact fields are empty", async () => {
    vi.mocked(createReleaseReviewDraft).mockResolvedValue(makeDraft());
    renderPanel({ summary: makeSummary() });

    await userEvent.click(screen.getByRole("button", { name: /Generate draft/ }));

    expect(await screen.findByLabelText("Release review markdown")).toBeInTheDocument();
    expect(vi.mocked(importCiArtifacts)).not.toHaveBeenCalled();
    expect(vi.mocked(createReleaseReviewDraft)).toHaveBeenCalledWith("run-1", {
      issues: [],
      ciArtifacts: []
    });
  });

  it("stops partial PR input before calling APIs", async () => {
    renderPanel({ summary: makeSummary() });

    await userEvent.type(screen.getByLabelText("PR URL"), "https://github.com/owner/repo/pull/42");
    await userEvent.click(screen.getByRole("button", { name: /Generate draft/ }));

    expect(screen.getByText("Draft input incomplete")).toBeInTheDocument();
    expect(vi.mocked(createReleaseReviewDraft)).not.toHaveBeenCalled();
    expect(vi.mocked(importCiArtifacts)).not.toHaveBeenCalled();
  });

  it("shows pending state when draft API returns null", async () => {
    vi.mocked(createReleaseReviewDraft).mockResolvedValue(null);
    renderPanel({ summary: makeSummary() });

    await userEvent.click(screen.getByRole("button", { name: /Generate draft/ }));

    expect(await screen.findByText("QMO summary pending")).toBeInTheDocument();
  });
});

function makeSummary(overrides: Partial<QmoSummary> = {}): QmoSummary {
  return {
    runId: "run-1",
    projectId: "project-1",
    generatedAt: "2026-05-01T00:00:00Z",
    outcome: "ready",
    testSummary: {
      total: 3,
      passed: 3,
      failed: 0,
      skipped: 0,
      flaky: 0,
      failedTests: []
    },
    qualityGate: {
      status: "passed",
      profile: "local-review",
      exitCode: 0,
      warnings: []
    },
    warnings: [],
    reportLinks: {},
    ...overrides
  };
}

function makeDraft(): ReleaseReviewDraft {
  const summary = makeSummary();
  return {
    runId: "run-1",
    projectId: "project-1",
    generatedAt: "2026-05-01T00:00:00Z",
    outcome: "ready",
    qmoSummary: summary,
    issues: [],
    ciArtifacts: [],
    markdown: "# Release Readiness Review\n\n- Outcome: `ready`\n"
  };
}

function makeImportResponse(): CiArtifactImportResponse {
  return {
    runId: "run-1",
    projectId: "project-1",
    imported: [
      {
        name: "allure-report",
        url: "https://github.com/owner/repo/actions/runs/1/artifacts/2",
        source: "github-actions",
        kind: "allure-report"
      }
    ],
    skipped: [],
    warnings: []
  };
}
