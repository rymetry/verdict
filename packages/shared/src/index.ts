import { z } from "zod";

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.literal("playwright-workbench-agent"),
  version: z.string(),
  timestamp: z.string()
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const PackageManagerSchema = z.enum(["npm", "pnpm", "yarn", "bun"]);
export type PackageManager = z.infer<typeof PackageManagerSchema>;

export const DetectionConfidenceSchema = z.enum(["high", "medium", "low"]);
export type DetectionConfidence = z.infer<typeof DetectionConfidenceSchema>;

export const CommandTemplateSchema = z.object({
  executable: z.string(),
  args: z.array(z.string())
});
export type CommandTemplate = z.infer<typeof CommandTemplateSchema>;

export const PackageManagerDetectionStatusSchema = z.enum([
  "ok",
  "ambiguous-lockfiles",
  "experimental-bun",
  "missing-playwright",
  "no-package-json",
  "no-lockfile-fallback"
]);
export type PackageManagerDetectionStatus = z.infer<typeof PackageManagerDetectionStatusSchema>;

export const DetectedPackageManagerSchema = z.object({
  name: PackageManagerSchema,
  status: PackageManagerDetectionStatusSchema,
  confidence: DetectionConfidenceSchema,
  reason: z.string(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  lockfiles: z.array(z.string()),
  packageManagerField: z.string().optional(),
  override: PackageManagerSchema.optional(),
  commandTemplates: z.object({
    playwrightTest: CommandTemplateSchema
  }),
  hasPlaywrightDevDependency: z.boolean(),
  /**
   * `true` when the local Playwright binary or PM-specific exec mechanism is
   * usable without an implicit install. PoC §8 forbids implicit installs.
   */
  localBinaryUsable: z.boolean(),
  blockingExecution: z.boolean()
});
export type DetectedPackageManager = z.infer<typeof DetectedPackageManagerSchema>;

export const ProjectOpenRequestSchema = z.object({
  rootPath: z.string().min(1),
  packageManagerOverride: PackageManagerSchema.optional()
});
export type ProjectOpenRequest = z.infer<typeof ProjectOpenRequestSchema>;

export const TestStepSchema = z.object({
  title: z.string(),
  line: z.number().int().positive().optional()
});
export type TestStep = z.infer<typeof TestStepSchema>;

export const TestCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  filePath: z.string(),
  relativePath: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().nonnegative(),
  describePath: z.array(z.string()),
  tags: z.array(z.string()),
  projectName: z.string().optional()
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const SpecFileSchema = z.object({
  filePath: z.string(),
  relativePath: z.string(),
  tests: z.array(TestCaseSchema)
});
export type SpecFile = z.infer<typeof SpecFileSchema>;

export const ProjectSummarySchema = z.object({
  id: z.string(),
  rootPath: z.string(),
  packageJsonPath: z.string().optional(),
  playwrightConfigPath: z.string().optional(),
  packageManager: DetectedPackageManagerSchema,
  hasAllurePlaywright: z.boolean(),
  hasAllureCli: z.boolean(),
  /**
   * Parsed semver of the resolved Allure CLI binary
   * (`node_modules/.bin/allure --version`). Populated only when
   * `hasAllureCli` is true and the probe succeeded. Phase 1.2 is tested
   * against Allure 3.x; 2.x produces a warning rather than a hard block,
   * since the operator may want to inspect raw stdout themselves.
   */
  allureCliVersion: z.string().optional(),
  /**
   * Project-relative `resultsDir` extracted from the `allure-playwright`
   * reporter clause in `playwright.config.{ts,js,mjs,cjs}` (Phase 1.2 / T203).
   * Optional: `undefined` when the reporter is absent, when its `resultsDir`
   * option is missing/dynamic (a corresponding warning is appended to
   * `warnings`), or when the value fails project-relative validation
   * (absolute, traversal, NUL, Windows-drive). The run pipeline (T203-2/3)
   * uses this to drive the detect/archive/copy lifecycle (PLAN.v2 §22),
   * falling back to default `allure-results` or user override when absent.
   */
  allureResultsDir: z.string().optional(),
  warnings: z.array(z.string()),
  blockingExecution: z.boolean()
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const InventorySourceSchema = z.enum([
  "playwright-list-json",
  "custom-reporter",
  "unavailable"
]);
export type InventorySource = z.infer<typeof InventorySourceSchema>;

export const TestInventorySchema = z.object({
  projectId: z.string(),
  source: InventorySourceSchema,
  generatedAt: z.string(),
  specs: z.array(SpecFileSchema),
  totals: z.object({
    specFiles: z.number().int().nonnegative(),
    tests: z.number().int().nonnegative()
  }),
  warnings: z.array(z.string()),
  /**
   * If inventory could not be retrieved (e.g. blocked by ambiguous lockfiles),
   * `error` describes why. UI surfaces this instead of an empty list.
   */
  error: z.string().optional()
});
export type TestInventory = z.infer<typeof TestInventorySchema>;

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "passed",
  "failed",
  "cancelled",
  "error"
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunCancellationReasonSchema = z.enum(["user-request", "internal"]);
export type RunCancellationReason = z.infer<typeof RunCancellationReasonSchema>;

/**
 * Inputs that flow to the Playwright CLI must not be allowed to act as
 * additional flags (PLAN.v2 §28 / security review). A bare leading `-`
 * is rejected; `..` and absolute paths are rejected for `specPath`.
 */
const noFlagInjection = (value: string): boolean => !value.startsWith("-");
const absolutePathLike = (value: string): boolean =>
  value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");

export const RunRequestSchema = z.object({
  projectId: z.string(),
  specPath: z
    .string()
    .refine(noFlagInjection, "specPath must not start with '-'")
    .refine((v) => !v.includes(".."), "specPath must not contain '..'")
    .refine((v) => !v.startsWith("/"), "specPath must be project-relative")
    .optional(),
  testIds: z
    .array(z.string().refine(noFlagInjection, "testId must not start with '-'"))
    .optional(),
  grep: z
    .string()
    .refine(noFlagInjection, "grep must not start with '-'")
    .optional(),
  projectNames: z
    .array(z.string().refine(noFlagInjection, "projectName must not start with '-'"))
    .optional(),
  headed: z.boolean().optional().default(false),
  /**
   * §1.4 Profile-driven Quality Gate rules. Default `"local-review"`
   * (lenient — Allure CLI defaults). Operators can choose `"release-smoke"`
   * or `"full-regression"` to apply stricter built-in thresholds, or
   * override the rules via
   * `<projectRoot>/.playwright-workbench/config/quality-gate-profiles.json`.
   */
  qualityGateProfile: z
    .enum(["local-review", "release-smoke", "full-regression"])
    .optional()
});
export type RunRequest = z.infer<typeof RunRequestSchema>;

export const EvidenceArtifactKindSchema = z.enum([
  "json",
  "html",
  "log",
  "trace",
  "screenshot",
  "video"
]);
export type EvidenceArtifactKind = z.infer<typeof EvidenceArtifactKindSchema>;

export const EvidenceArtifactSchema = z.object({
  kind: EvidenceArtifactKindSchema,
  path: z.string(),
  label: z.string()
});
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;

export const FailedTestSchema = z.object({
  testId: z.string().optional(),
  title: z.string(),
  fullTitle: z.string().optional(),
  filePath: z.string().optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().nonnegative().optional(),
  status: z.string(),
  durationMs: z.number().int().nonnegative().optional(),
  message: z.string().optional(),
  stack: z.string().optional(),
  attachments: z.array(EvidenceArtifactSchema)
});
export type FailedTest = z.infer<typeof FailedTestSchema>;

export const TestResultSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  flaky: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
  failedTests: z.array(FailedTestSchema)
});
export type TestResultSummary = z.infer<typeof TestResultSummarySchema>;

export const RunPathsSchema = z.object({
  runDir: z.string(),
  metadataJson: z.string(),
  stdoutLog: z.string(),
  stderrLog: z.string(),
  playwrightJson: z.string(),
  playwrightHtml: z.string(),
  artifactsJson: z.string(),
  /**
   * Phase 1.2 (T203-2): destination for the post-run copy of the user's
   * `allure-results/*`. Always derivable for every run; only populated
   * when the project uses allure-playwright and the run pipeline calls
   * `RunArtifactsStore.copyAllureResultsDir`.
   */
  allureResultsDest: z.string(),
  /**
   * Phase 1.2 (T204-1): destination for the Allure HTML report
   * generated by `allure generate -o <here>`. Always derivable;
   * only populated when T204-2's `generateAllureReport` lifecycle
   * hook successfully runs. UI later renders this as a link.
   */
  allureReportDir: z.string(),
  /**
   * Phase 1.2 (T205-2): persisted Quality Gate result JSON. Always
   * derivable; only written when the quality-gate lifecycle hook
   * runs (project uses Allure + allure CLI installed + results
   * present in the run-scoped allure-results dir).
   */
  qualityGateResultPath: z.string(),
  /**
   * Phase 1.2 (T207): run-scoped Allure CLI exports. CSV is produced
   * by `allure csv`; log is captured from `allure log` stdout.
   */
  allureExportsDir: z.string(),
  allureCsvPath: z.string(),
  allureLogPath: z.string(),
  /**
   * Phase 1.2 (T207): QMO Release Readiness Summary v0 — JSON form.
   * Derived from RunMetadata + QualityGateResult after the QG step.
   * Always derivable; only populated when the QMO summary lifecycle
   * hook runs.
   */
  qmoSummaryJsonPath: z.string(),
  /**
   * Phase 1.2 (T207): QMO Release Readiness Summary v0 — Markdown form.
   * Same data as the JSON form, formatted for human review (PR
   * comments, release-readiness reviews).
   */
  qmoSummaryMarkdownPath: z.string()
});
export type RunPaths = z.infer<typeof RunPathsSchema>;

export const RunMetadataSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  projectRoot: z.string(),
  status: RunStatusSchema,
  startedAt: z.string(),
  completedAt: z.string().optional(),
  command: CommandTemplateSchema,
  cwd: z.string(),
  exitCode: z.number().int().nullable().optional(),
  signal: z.string().nullable().optional(),
  cancelReason: RunCancellationReasonSchema.optional(),
  durationMs: z.number().int().nonnegative().optional(),
  requested: RunRequestSchema,
  paths: RunPathsSchema,
  summary: TestResultSummarySchema.optional(),
  warnings: z.array(z.string())
});
export type RunMetadata = z.infer<typeof RunMetadataSchema>;

export const QualityGateProfileSchema = z.enum([
  "local-review",
  "release-smoke",
  "full-regression"
]);
export type QualityGateProfile = z.infer<typeof QualityGateProfileSchema>;

export const QualityGateResultSchema = z.object({
  status: z.enum(["passed", "failed", "skipped", "error"]),
  profile: QualityGateProfileSchema,
  evaluatedAt: z.string(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  reportPath: z.string().optional(),
  warnings: z.array(z.string())
});
export type QualityGateResult = z.infer<typeof QualityGateResultSchema>;

/**
 * Phase 1.2 / T207: QMO Release Readiness Summary v0.
 *
 * `outcome` derivation (PLAN.v2 §27):
 *   - "ready": all tests passed AND quality gate passed (or skipped
 *     because Allure is not configured)
 *   - "conditional": tests passed but quality gate warnings or non-fatal
 *     errors are present (e.g. CLI binary missing, no-results)
 *   - "not-ready": any test failed OR quality gate failed
 *
 * Future extensions (deferred): flaky candidate detection,
 * known-issues integration, AI Release Readiness commentary.
 */
export const QmoSummaryOutcomeSchema = z.enum(["ready", "conditional", "not-ready"]);
export type QmoSummaryOutcome = z.infer<typeof QmoSummaryOutcomeSchema>;

export const QmoSummarySchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  outcome: QmoSummaryOutcomeSchema,
  testSummary: TestResultSummarySchema.optional(),
  qualityGate: z
    .object({
      status: z.enum(["passed", "failed", "skipped", "error"]),
      profile: z.string(),
      exitCode: z.number().int().nullable(),
      warnings: z.array(z.string())
    })
    .optional(),
  warnings: z.array(z.string()),
  reportLinks: z.object({
    allureReportDir: z.string().optional(),
    qualityGateResultPath: z.string().optional()
  }),
  runDurationMs: z.number().int().nonnegative().optional(),
  command: CommandTemplateSchema.optional()
});
export type QmoSummary = z.infer<typeof QmoSummarySchema>;

/**
 * §1.3 Allure history JSONL entry (Phase 1.2 / T206).
 *
 * `<projectRoot>/.playwright-workbench/reports/allure-history.jsonl` is
 * appended by the Allure CLI on each `allure history --history-path`
 * invocation. Each line is one JSON object describing the run's
 * aggregate report; the precise field set varies between Allure
 * versions. We pin the fields the GUI trend card needs and pass
 * remaining keys through (Allure 3 ships forward-compatible additions).
 *
 * `generatedAt` is required so the hook can sort by recency without
 * heuristics; everything else is optional because Allure history files
 * predating Phase 1.2 may have a thinner shape.
 */
export const AllureHistoryEntrySchema = z
  .object({
    generatedAt: z.string(),
    reportName: z.string().optional(),
    runUuid: z.string().optional(),
    total: z.number().int().nonnegative().optional(),
    passed: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative().optional(),
    broken: z.number().int().nonnegative().optional(),
    skipped: z.number().int().nonnegative().optional(),
    unknown: z.number().int().nonnegative().optional(),
    flaky: z.number().int().nonnegative().optional(),
    durationMs: z.number().int().nonnegative().optional()
  })
  .passthrough();
export type AllureHistoryEntry = z.infer<typeof AllureHistoryEntrySchema>;

export const AllureHistoryResponseSchema = z.object({
  /** Number of lines successfully parsed and validated. */
  entries: z.array(AllureHistoryEntrySchema),
  /**
   * Surface why some lines were skipped (parse failure / schema mismatch
   * / read failure). UI shows them as a low-volume warnings list rather
   * than failing the whole trend card.
   */
  warnings: z.array(z.string())
});
export type AllureHistoryResponse = z.infer<typeof AllureHistoryResponseSchema>;

export const FailureReviewKnownIssueSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  message: z.string().optional(),
  status: z.string().optional(),
  historyId: z.string().optional(),
  testCaseId: z.string().optional()
});
export type FailureReviewKnownIssue = z.infer<typeof FailureReviewKnownIssueSchema>;

export const FailureReviewHistoryEntrySchema = z.object({
  generatedAt: z.string(),
  status: z.string(),
  runUuid: z.string().optional(),
  reportName: z.string().optional()
});
export type FailureReviewHistoryEntry = z.infer<typeof FailureReviewHistoryEntrySchema>;

export const FailureReviewFlakySignalSchema = z.object({
  isCandidate: z.boolean(),
  passedRuns: z.number().int().nonnegative(),
  failedRuns: z.number().int().nonnegative(),
  brokenRuns: z.number().int().nonnegative(),
  skippedRuns: z.number().int().nonnegative(),
  recentStatuses: z.array(z.string())
});
export type FailureReviewFlakySignal = z.infer<typeof FailureReviewFlakySignalSchema>;

export const FailureReviewTestSchema = z.object({
  test: FailedTestSchema,
  history: z.array(FailureReviewHistoryEntrySchema),
  knownIssues: z.array(FailureReviewKnownIssueSchema),
  flaky: FailureReviewFlakySignalSchema
});
export type FailureReviewTest = z.infer<typeof FailureReviewTestSchema>;

export const FailureReviewResponseSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  status: RunStatusSchema,
  completedAt: z.string().optional(),
  failedTests: z.array(FailureReviewTestSchema),
  warnings: z.array(z.string())
});
export type FailureReviewResponse = z.infer<typeof FailureReviewResponseSchema>;

/* ----------------------------------------------------------------------- */
/* WebSocket event envelope (PLAN.v2 §20)                                  */
/* ----------------------------------------------------------------------- */

export const RunStdStreamPayloadSchema = z.object({
  chunk: z.string()
});
export type RunStdStreamPayload = z.infer<typeof RunStdStreamPayloadSchema>;

export const RunQueuedPayloadSchema = z.object({
  request: RunRequestSchema
});
export type RunQueuedPayload = z.infer<typeof RunQueuedPayloadSchema>;

export const RunStartedPayloadSchema = z.object({
  command: CommandTemplateSchema,
  cwd: z.string().refine(absolutePathLike, "cwd must be an absolute path"),
  startedAt: z.string().datetime()
});
export type RunStartedPayload = z.infer<typeof RunStartedPayloadSchema>;

export const SnapshotPayloadSchema = z.object({
  service: z.string(),
  version: z.string()
});
export type SnapshotPayload = z.infer<typeof SnapshotPayloadSchema>;

const RunTerminalPayloadBaseSchema = z.object({
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable().optional(),
  durationMs: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([])
});

export const RunCompletedPayloadSchema = RunTerminalPayloadBaseSchema.extend({
  status: z.enum(["passed", "failed"]),
  summary: TestResultSummarySchema.optional()
});
export type RunCompletedPayload = z.infer<typeof RunCompletedPayloadSchema>;

export const RunCancelledPayloadSchema = RunTerminalPayloadBaseSchema.extend({
  status: z.literal("cancelled"),
  cancelReason: RunCancellationReasonSchema.default("internal")
});
export type RunCancelledPayload = z.infer<typeof RunCancelledPayloadSchema>;

export const RunErrorPayloadSchema = RunTerminalPayloadBaseSchema.extend({
  status: z.literal("error"),
  message: z.string().min(1)
});
export type RunErrorPayload = z.infer<typeof RunErrorPayloadSchema>;

export const RunTerminalPayloadSchema = z.discriminatedUnion("status", [
  RunCompletedPayloadSchema,
  RunCancelledPayloadSchema,
  RunErrorPayloadSchema
]);
export type RunTerminalPayload = z.infer<typeof RunTerminalPayloadSchema>;

/**
 * Single source of truth for terminal event type and terminal payload status.
 * Producers and UI consumers both use this to reject cross-wired payloads.
 */
export const TerminalStatusByEvent = {
  "run.completed": new Set<RunTerminalPayload["status"]>(["passed", "failed"]),
  "run.cancelled": new Set<RunTerminalPayload["status"]>(["cancelled"]),
  "run.error": new Set<RunTerminalPayload["status"]>(["error"])
} as const;

export type TerminalEventType = keyof typeof TerminalStatusByEvent;

export function isTerminalEventType(type: WorkbenchEventType): type is TerminalEventType {
  return type === "run.completed" || type === "run.cancelled" || type === "run.error";
}

/** Returns true when a terminal payload status is valid for the envelope type. */
export function terminalStatusMatchesEvent(
  type: TerminalEventType,
  status: RunTerminalPayload["status"]
): boolean {
  return TerminalStatusByEvent[type].has(status);
}

export const WorkbenchEventTypeSchema = z.enum([
  "run.queued",
  "run.started",
  "run.stdout",
  "run.stderr",
  "run.completed",
  "run.cancelled",
  "run.error",
  "snapshot"
]);
export type WorkbenchEventType = z.infer<typeof WorkbenchEventTypeSchema>;

const WorkbenchRunEventBaseSchema = z.object({
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  runId: z.string()
});

const WorkbenchSnapshotEventBaseSchema = z.object({
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime()
});

export const WorkbenchEventSchema = z.discriminatedUnion("type", [
  WorkbenchRunEventBaseSchema.extend({
    type: z.literal("run.queued"),
    payload: RunQueuedPayloadSchema
  }),
  WorkbenchRunEventBaseSchema.extend({
    type: z.literal("run.started"),
    payload: RunStartedPayloadSchema
  }),
  WorkbenchRunEventBaseSchema.extend({
    type: z.literal("run.stdout"),
    payload: RunStdStreamPayloadSchema
  }),
  WorkbenchRunEventBaseSchema.extend({
    type: z.literal("run.stderr"),
    payload: RunStdStreamPayloadSchema
  }),
  WorkbenchRunEventBaseSchema.extend({
    type: z.literal("run.completed"),
    payload: RunCompletedPayloadSchema
  }),
  WorkbenchRunEventBaseSchema.extend({
    type: z.literal("run.cancelled"),
    payload: RunCancelledPayloadSchema
  }),
  WorkbenchRunEventBaseSchema.extend({
    type: z.literal("run.error"),
    payload: RunErrorPayloadSchema
  }),
  WorkbenchSnapshotEventBaseSchema.extend({
    type: z.literal("snapshot"),
    payload: SnapshotPayloadSchema
  })
]);
export type WorkbenchEvent = z.infer<typeof WorkbenchEventSchema>;
export type WorkbenchEventInput =
  | { type: "run.queued"; runId: string; payload: RunQueuedPayload }
  | { type: "run.started"; runId: string; payload: RunStartedPayload }
  | { type: "run.stdout"; runId: string; payload: RunStdStreamPayload }
  | { type: "run.stderr"; runId: string; payload: RunStdStreamPayload }
  | { type: "run.completed"; runId: string; payload: RunCompletedPayload }
  | { type: "run.cancelled"; runId: string; payload: RunCancelledPayload }
  | { type: "run.error"; runId: string; payload: RunErrorPayload }
  | { type: "snapshot"; payload: SnapshotPayload };

/* ----------------------------------------------------------------------- */
/* HTTP API responses                                                      */
/* ----------------------------------------------------------------------- */

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string()
  })
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const RunListItemSchema = RunMetadataSchema.pick({
  runId: true,
  projectId: true,
  status: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
  exitCode: true,
  summary: true,
  warnings: true
});
export type RunListItem = z.infer<typeof RunListItemSchema>;

export const RunListResponseSchema = z.object({
  runs: z.array(RunListItemSchema)
});
export type RunListResponse = z.infer<typeof RunListResponseSchema>;
