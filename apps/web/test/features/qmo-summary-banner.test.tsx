// QmoSummaryBanner の純粋 render test。hook 統合は use-latest-qmo-summary.test.ts で検証する。

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { QmoSummary } from "@pwqa/shared";

import { QmoSummaryBanner } from "@/features/qmo-summary-banner/QmoSummaryBanner";

function makeSummary(overrides: Partial<QmoSummary> = {}): QmoSummary {
  return {
    runId: "run-1",
    projectId: "/p",
    generatedAt: "2026-04-30T05:00:00Z",
    outcome: "ready",
    testSummary: {
      total: 5,
      passed: 5,
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
    reportLinks: {
      allureReportDir: "/runs/run-1/allure-report",
      qualityGateResultPath: "/runs/run-1/quality-gate-result.json"
    },
    runDurationMs: 60_000,
    command: { executable: "npx", args: ["playwright", "test"] },
    ...overrides
  };
}

describe("QmoSummaryBanner", () => {
  it("renders nothing in the loading state (summary === undefined, not error)", () => {
    const { container } = render(<QmoSummaryBanner summary={undefined} isError={false} isEmpty={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders an error message when isError is true", () => {
    render(<QmoSummaryBanner summary={undefined} isError={true} isEmpty={false} />);
    expect(screen.getByTestId("qmo-summary-banner-error")).toBeInTheDocument();
    expect(screen.getByText("QMO summary unavailable")).toBeInTheDocument();
  });

  it("renders the no-runs message when isEmpty is true (project just opened, never ran)", () => {
    // Without this branch the empty-runs-list state would render null
    // (loading branch), indistinguishable from "still fetching".
    render(<QmoSummaryBanner summary={undefined} isError={false} isEmpty={true} />);
    expect(screen.getByTestId("qmo-summary-banner-no-runs")).toBeInTheDocument();
    expect(
      screen.getByText("No runs yet. Trigger a test run to populate this summary.")
    ).toBeInTheDocument();
  });

  it("isEmpty branch takes precedence over the loading null state", () => {
    render(<QmoSummaryBanner summary={undefined} isError={false} isEmpty={true} />);
    expect(screen.getByTestId("qmo-summary-banner-no-runs")).toBeInTheDocument();
  });

  it("isError takes precedence over isEmpty (operator-actionable signal first)", () => {
    render(<QmoSummaryBanner summary={undefined} isError={true} isEmpty={true} />);
    expect(screen.getByTestId("qmo-summary-banner-error")).toBeInTheDocument();
    expect(screen.queryByTestId("qmo-summary-banner-no-runs")).not.toBeInTheDocument();
  });

  it("renders an empty-state message when summary is null (409 NO_QMO_SUMMARY)", () => {
    render(<QmoSummaryBanner summary={null} isError={false} isEmpty={false} />);
    expect(screen.getByTestId("qmo-summary-banner-empty")).toBeInTheDocument();
    expect(screen.getByText("QMO summary not yet generated for this run.")).toBeInTheDocument();
  });

  it("renders Ready outcome with `pass` Badge variant when outcome=ready", () => {
    render(<QmoSummaryBanner summary={makeSummary({ outcome: "ready" })} isError={false} isEmpty={false} />);
    const outcome = screen.getByTestId("qmo-summary-banner-outcome");
    expect(outcome).toHaveTextContent("Ready");
  });

  it("renders Conditional outcome when outcome=conditional", () => {
    const summary = makeSummary({
      outcome: "conditional",
      qualityGate: {
        status: "passed",
        profile: "local-review",
        exitCode: 0,
        warnings: ["Test count below threshold"]
      }
    });
    render(<QmoSummaryBanner summary={summary} isError={false} isEmpty={false} />);
    expect(screen.getByTestId("qmo-summary-banner-outcome")).toHaveTextContent("Conditional");
  });

  it("renders Not Ready outcome with `fail` Badge variant when outcome=not-ready", () => {
    const summary = makeSummary({
      outcome: "not-ready",
      testSummary: {
        total: 5,
        passed: 4,
        failed: 1,
        skipped: 0,
        flaky: 0,
        failedTests: [
          {
            title: "broken",
            fullTitle: "suite > broken",
            status: "failed",
            attachments: []
          }
        ]
      }
    });
    render(<QmoSummaryBanner summary={summary} isError={false} isEmpty={false} />);
    expect(screen.getByTestId("qmo-summary-banner-outcome")).toHaveTextContent("Not Ready");
  });

  it("renders test counts including failures and skips when present", () => {
    const summary = makeSummary({
      testSummary: {
        total: 7,
        passed: 4,
        failed: 2,
        skipped: 1,
        flaky: 0,
        failedTests: []
      }
    });
    render(<QmoSummaryBanner summary={summary} isError={false} isEmpty={false} />);
    const tests = screen.getByTestId("qmo-summary-banner-tests");
    expect(tests).toHaveTextContent("tests: 4/7 pass");
    expect(tests).toHaveTextContent("2 fail");
    expect(tests).toHaveTextContent("1 skip");
  });

  it("renders QG status and profile when qualityGate is present", () => {
    const summary = makeSummary({
      qualityGate: {
        status: "failed",
        profile: "release-smoke",
        exitCode: 1,
        warnings: []
      }
    });
    render(<QmoSummaryBanner summary={summary} isError={false} isEmpty={false} />);
    const qg = screen.getByTestId("qmo-summary-banner-qg");
    expect(qg).toHaveTextContent("QG: failed (release-smoke)");
  });

  it("omits QG row when qualityGate is undefined (project not Allure-configured)", () => {
    const summary = makeSummary({ qualityGate: undefined });
    render(<QmoSummaryBanner summary={summary} isError={false} isEmpty={false} />);
    expect(screen.queryByTestId("qmo-summary-banner-qg")).not.toBeInTheDocument();
  });

  it("renders run duration in seconds when defined", () => {
    const summary = makeSummary({ runDurationMs: 12_500 });
    render(<QmoSummaryBanner summary={summary} isError={false} isEmpty={false} />);
    expect(screen.getByTestId("qmo-summary-banner-duration")).toHaveTextContent("13s");
  });

  it("omits duration when runDurationMs is undefined", () => {
    const summary = makeSummary({ runDurationMs: undefined });
    render(<QmoSummaryBanner summary={summary} isError={false} isEmpty={false} />);
    expect(screen.queryByTestId("qmo-summary-banner-duration")).not.toBeInTheDocument();
  });
});
