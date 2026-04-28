import { type TestResultSummary } from "@pwqa/shared";

/**
 * PLAN.v2 §16: ReportProvider unifies how Workbench reads test result
 * artifacts. Phase 1 ships `PlaywrightJsonReportProvider`; additional
 * providers can be added without touching the run pipeline.
 */
export interface ReportProvider {
  readonly name: string;
  /**
   * Build a `TestResultSummary` from a finished run's artifact directory.
   * Returns `undefined` when no artifacts are available yet.
   */
  readSummary(input: ReportProviderInput): Promise<ReadSummaryResult | undefined>;
}

export interface ReportProviderInput {
  projectRoot: string;
  runDir: string;
  /** Absolute path of the Playwright JSON output file. */
  playwrightJsonPath: string;
}

export interface ReadSummaryResult {
  summary: TestResultSummary;
  warnings: string[];
}
