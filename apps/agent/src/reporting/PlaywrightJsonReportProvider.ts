import * as fs from "node:fs/promises";
import { summarizePlaywrightJson } from "../playwright/jsonReport.js";
import type {
  ReadSummaryResult,
  ReportProvider,
  ReportProviderInput
} from "./ReportProvider.js";

export const playwrightJsonReportProvider: ReportProvider = {
  name: "playwright-json",
  async readSummary(input: ReportProviderInput): Promise<ReadSummaryResult | undefined> {
    const raw = await fs.readFile(input.playwrightJsonPath, "utf8");
    if (!raw) return undefined;
    return summarizePlaywrightJson(input.projectRoot, raw);
  }
};
