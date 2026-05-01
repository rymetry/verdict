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

export const QaMetadataSourceSchema = z.enum([
  "playwright-list-json",
  "static-analysis",
  "allure-metadata"
]);
export type QaMetadataSource = z.infer<typeof QaMetadataSourceSchema>;

export const QaMetadataConfidenceSchema = z.enum(["low", "medium", "high"]);
export type QaMetadataConfidence = z.infer<typeof QaMetadataConfidenceSchema>;

export const QaTestMetadataSchema = z.object({
  purpose: z.string(),
  steps: z.array(TestStepSchema),
  expectations: z.array(TestStepSchema),
  source: QaMetadataSourceSchema,
  confidence: QaMetadataConfidenceSchema
});
export type QaTestMetadata = z.infer<typeof QaTestMetadataSchema>;

export const TestCodeSignalKindSchema = z.enum([
  "locator",
  "assertion",
  "allure-metadata"
]);
export type TestCodeSignalKind = z.infer<typeof TestCodeSignalKindSchema>;

export const TestCodeSignalSchema = z.object({
  kind: TestCodeSignalKindSchema,
  value: z.string().min(1),
  line: z.number().int().positive().optional(),
  source: QaMetadataSourceSchema
});
export type TestCodeSignal = z.infer<typeof TestCodeSignalSchema>;

export const TestCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  fullTitle: z.string(),
  filePath: z.string(),
  relativePath: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().nonnegative(),
  describePath: z.array(z.string()),
  tags: z.array(z.string()),
  projectName: z.string().optional(),
  qaMetadata: QaTestMetadataSchema,
  codeSignals: z.array(TestCodeSignalSchema).optional()
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

export const ConfigReporterSchema = z.object({
  name: z.string(),
  source: z.literal("heuristic")
});
export type ConfigReporter = z.infer<typeof ConfigReporterSchema>;

export const ConfigUseOptionSchema = z.object({
  name: z.enum(["trace", "screenshot", "video"]),
  value: z.string(),
  source: z.literal("heuristic")
});
export type ConfigUseOption = z.infer<typeof ConfigUseOptionSchema>;

export const FixtureSignalSchema = z.enum(["fixture-path", "test-extend"]);
export type FixtureSignal = z.infer<typeof FixtureSignalSchema>;

export const FixtureEntrySchema = z.object({
  relativePath: z.string(),
  kind: z.enum(["fixture-file", "test-extend"]),
  signals: z.array(FixtureSignalSchema),
  sizeBytes: z.number().int().nonnegative()
});
export type FixtureEntry = z.infer<typeof FixtureEntrySchema>;

export const PomLocatorSignalSchema = z.object({
  value: z.string().min(1),
  line: z.number().int().positive().optional(),
  source: z.literal("heuristic")
});
export type PomLocatorSignal = z.infer<typeof PomLocatorSignalSchema>;

export const PomEntrySchema = z.object({
  relativePath: z.string(),
  kind: z.enum(["page-object", "page-like-file"]),
  classNames: z.array(z.string()),
  locatorCount: z.number().int().nonnegative(),
  locatorSamples: z.array(PomLocatorSignalSchema),
  sizeBytes: z.number().int().nonnegative()
});
export type PomEntry = z.infer<typeof PomEntrySchema>;

export const AuthSetupRiskSignalSchema = z.enum([
  "storage-state-path",
  "storage-state-inline",
  "global-setup",
  "auth-setup-file"
]);
export type AuthSetupRiskSignal = z.infer<typeof AuthSetupRiskSignalSchema>;

export const AuthSetupRiskSeveritySchema = z.enum(["info", "warning", "high"]);
export type AuthSetupRiskSeverity = z.infer<typeof AuthSetupRiskSeveritySchema>;

export const AuthSetupRiskSchema = z.object({
  signal: AuthSetupRiskSignalSchema,
  severity: AuthSetupRiskSeveritySchema,
  message: z.string().min(1),
  relativePath: z.string().optional(),
  source: z.literal("heuristic")
});
export type AuthSetupRisk = z.infer<typeof AuthSetupRiskSchema>;

export const ProjectConfigSummarySchema = z.object({
  projectId: z.string(),
  generatedAt: z.string(),
  config: z.object({
    path: z.string().optional(),
    relativePath: z.string().optional(),
    format: z.enum(["ts", "js", "mjs", "cjs", "unknown"]),
    sizeBytes: z.number().int().nonnegative().optional()
  }),
  reporters: z.array(ConfigReporterSchema),
  useOptions: z.array(ConfigUseOptionSchema),
  fixtureFiles: z.array(FixtureEntrySchema),
  pomFiles: z.array(PomEntrySchema).default([]),
  authRisks: z.array(AuthSetupRiskSchema).default([]),
  warnings: z.array(z.string())
});
export type ProjectConfigSummary = z.infer<typeof ProjectConfigSummarySchema>;

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
const httpUrl = (value: string): boolean => {
  const lower = value.toLowerCase();
  return lower.startsWith("https://") || lower.startsWith("http://");
};

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
  retries: z.number().int().nonnegative().optional(),
  workers: z.number().int().positive().optional(),
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
  relativePath: z.string().optional(),
  absolutePath: z.string().optional(),
  label: z.string()
});
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;

export const FailedTestSchema = z.object({
  testId: z.string().optional(),
  title: z.string(),
  fullTitle: z.string().optional(),
  filePath: z.string().optional(),
  relativeFilePath: z.string().optional(),
  absoluteFilePath: z.string().optional(),
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
export const QualityGateEnforcementSchema = z.enum(["advisory", "blocking"]);
export type QualityGateEnforcement = z.infer<typeof QualityGateEnforcementSchema>;

export const QualityGateRuleEvaluationSchema = z.object({
  id: z.string(),
  name: z.string(),
  threshold: z.string(),
  actual: z.string(),
  status: z.enum(["pass", "fail"]),
  message: z.string()
});
export type QualityGateRuleEvaluation = z.infer<
  typeof QualityGateRuleEvaluationSchema
>;

export const QualityGateResultSchema = z.object({
  status: z.enum(["passed", "failed", "skipped", "error"]),
  profile: QualityGateProfileSchema,
  enforcement: QualityGateEnforcementSchema.optional(),
  evaluatedAt: z.string(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  reportPath: z.string().optional(),
  rules: z.array(QualityGateRuleEvaluationSchema).optional(),
  failedRules: z.array(QualityGateRuleEvaluationSchema).optional(),
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
      enforcement: QualityGateEnforcementSchema.optional(),
      exitCode: z.number().int().nullable(),
      rules: z.array(QualityGateRuleEvaluationSchema).optional(),
      failedRules: z.array(QualityGateRuleEvaluationSchema).optional(),
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

const HttpUrlStringSchema = z.string().url().refine(httpUrl, "URL must use http or https");

const ProjectRelativeTracePathSchema = z
  .string()
  .min(1)
  .refine(noFlagInjection, "tracePath must not start with '-'")
  .refine((value) => !value.split(/[\\/]+/).includes(".."), "tracePath must not contain '..'")
  .refine((value) => !absolutePathLike(value), "tracePath must be project-relative")
  .refine((value) => value.toLowerCase().endsWith(".zip"), "tracePath must point to a .zip file");

export const PlaywrightLaunchKindSchema = z.enum(["ui-mode", "codegen", "trace-viewer"]);
export type PlaywrightLaunchKind = z.infer<typeof PlaywrightLaunchKindSchema>;

export const PlaywrightLaunchCommandRequestSchema = z
  .object({
    kind: PlaywrightLaunchKindSchema,
    codegenUrl: HttpUrlStringSchema.optional(),
    tracePath: ProjectRelativeTracePathSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.kind === "trace-viewer" && !value.tracePath) {
      ctx.addIssue({
        code: "custom",
        path: ["tracePath"],
        message: "tracePath is required for trace-viewer"
      });
    }
    if (value.kind !== "trace-viewer" && value.tracePath) {
      ctx.addIssue({
        code: "custom",
        path: ["tracePath"],
        message: "tracePath is only supported for trace-viewer"
      });
    }
    if (value.kind !== "codegen" && value.codegenUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["codegenUrl"],
        message: "codegenUrl is only supported for codegen"
      });
    }
  });
export type PlaywrightLaunchCommandRequest = z.infer<typeof PlaywrightLaunchCommandRequestSchema>;

export const PlaywrightLaunchCommandResponseSchema = z.object({
  projectId: z.string(),
  kind: PlaywrightLaunchKindSchema,
  command: CommandTemplateSchema,
  warnings: z.array(z.string())
});
export type PlaywrightLaunchCommandResponse = z.infer<typeof PlaywrightLaunchCommandResponseSchema>;

export const GitHubPullRequestLinkSchema = z.object({
  url: HttpUrlStringSchema,
  repository: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  headSha: z.string().min(7).optional()
});
export type GitHubPullRequestLink = z.infer<typeof GitHubPullRequestLinkSchema>;

export const GitHubIssueLinkSchema = z.object({
  url: HttpUrlStringSchema,
  repository: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string().min(1).optional(),
  state: z.enum(["open", "closed"]).optional()
});
export type GitHubIssueLink = z.infer<typeof GitHubIssueLinkSchema>;

export const CiArtifactKindSchema = z.enum([
  "playwright-report",
  "playwright-results",
  "allure-report",
  "allure-results",
  "quality-gate",
  "qmo-summary",
  "log",
  "other"
]);
export type CiArtifactKind = z.infer<typeof CiArtifactKindSchema>;

export const CiArtifactSourceSchema = z.enum([
  "github-actions",
  "allure",
  "playwright",
  "external"
]);
export type CiArtifactSource = z.infer<typeof CiArtifactSourceSchema>;

export const CiArtifactLinkSchema = z.object({
  name: z.string().min(1),
  url: HttpUrlStringSchema,
  source: CiArtifactSourceSchema,
  kind: CiArtifactKindSchema,
  workflowRunId: z.number().int().positive().optional(),
  sizeBytes: z.number().int().nonnegative().optional()
});
export type CiArtifactLink = z.infer<typeof CiArtifactLinkSchema>;

export const CiArtifactImportSourceSchema = z.object({
  name: z.string().min(1),
  url: HttpUrlStringSchema,
  source: CiArtifactSourceSchema.default("github-actions"),
  workflowRunId: z.number().int().positive().optional(),
  sizeBytes: z.number().int().nonnegative().optional()
});
export type CiArtifactImportSource = z.input<typeof CiArtifactImportSourceSchema>;

export const CiArtifactImportRequestSchema = z.object({
  artifacts: z.array(CiArtifactImportSourceSchema)
});
export type CiArtifactImportRequest = z.input<typeof CiArtifactImportRequestSchema>;

export const CiArtifactImportSkippedSchema = z.object({
  name: z.string(),
  url: HttpUrlStringSchema.optional(),
  reason: z.enum(["unsupported-kind"])
});
export type CiArtifactImportSkipped = z.infer<typeof CiArtifactImportSkippedSchema>;

export const CiArtifactImportResponseSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  imported: z.array(CiArtifactLinkSchema),
  skipped: z.array(CiArtifactImportSkippedSchema),
  warnings: z.array(z.string())
});
export type CiArtifactImportResponse = z.infer<typeof CiArtifactImportResponseSchema>;

export const ReleaseReviewDraftRequestSchema = z.object({
  pullRequest: GitHubPullRequestLinkSchema.optional(),
  issues: z.array(GitHubIssueLinkSchema).default([]),
  ciArtifacts: z.array(CiArtifactLinkSchema).default([])
});
export type ReleaseReviewDraftRequest = z.infer<typeof ReleaseReviewDraftRequestSchema>;

export const ReleaseReviewDraftSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  outcome: QmoSummaryOutcomeSchema,
  qmoSummary: QmoSummarySchema,
  pullRequest: GitHubPullRequestLinkSchema.optional(),
  issues: z.array(GitHubIssueLinkSchema),
  ciArtifacts: z.array(CiArtifactLinkSchema),
  markdown: z.string()
});
export type ReleaseReviewDraft = z.infer<typeof ReleaseReviewDraftSchema>;

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

export const AiAnalysisLogExcerptSchema = z.object({
  stream: z.enum(["stdout", "stderr"]),
  text: z.string(),
  truncated: z.boolean(),
  redactions: z.number().int().nonnegative()
});
export type AiAnalysisLogExcerpt = z.infer<typeof AiAnalysisLogExcerptSchema>;

export const AiAnalysisFailureContextSchema = z.object({
  testId: z.string().optional(),
  title: z.string(),
  fullTitle: z.string().optional(),
  status: z.string(),
  location: z
    .object({
      relativePath: z.string(),
      line: z.number().int().positive().optional(),
      column: z.number().int().nonnegative().optional()
    })
    .optional(),
  message: z.string().optional(),
  stack: z.string().optional(),
  attachments: z.array(EvidenceArtifactSchema),
  history: z.array(FailureReviewHistoryEntrySchema),
  knownIssues: z.array(FailureReviewKnownIssueSchema),
  flaky: FailureReviewFlakySignalSchema
});
export type AiAnalysisFailureContext = z.infer<typeof AiAnalysisFailureContextSchema>;

export const AiAnalysisContextSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  generatedAt: z.string(),
  status: RunStatusSchema,
  command: CommandTemplateSchema,
  requested: RunRequestSchema,
  summary: TestResultSummarySchema.optional(),
  failures: z.array(AiAnalysisFailureContextSchema),
  logs: z.array(AiAnalysisLogExcerptSchema),
  warnings: z.array(z.string())
});
export type AiAnalysisContext = z.infer<typeof AiAnalysisContextSchema>;

export const AiAnalysisOutputSchema = z.object({
  classification: z.enum([
    "product-bug",
    "test-bug",
    "environment",
    "flaky",
    "unknown"
  ]),
  rootCause: z.string(),
  evidence: z.array(z.string()),
  risk: z.array(z.string()),
  proposedPatch: z.string().optional(),
  filesTouched: z.array(z.string()),
  rerunCommand: z.string().optional(),
  confidence: z.number().min(0).max(1),
  requiresHumanDecision: z.boolean()
});
export type AiAnalysisOutput = z.infer<typeof AiAnalysisOutputSchema>;

export const AiAnalysisProviderSchema = z.enum(["claude-code"]);
export type AiAnalysisProvider = z.infer<typeof AiAnalysisProviderSchema>;

export const AiAnalysisRequestSchema = z.object({
  provider: AiAnalysisProviderSchema.optional().default("claude-code")
});
export type AiAnalysisRequest = z.infer<typeof AiAnalysisRequestSchema>;

export const AiAnalysisResponseSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  provider: AiAnalysisProviderSchema,
  generatedAt: z.string(),
  analysis: AiAnalysisOutputSchema,
  warnings: z.array(z.string())
});
export type AiAnalysisResponse = z.infer<typeof AiAnalysisResponseSchema>;

export const AiTestGenerationModeSchema = z.enum(["planner", "generator", "healer"]);
export type AiTestGenerationMode = z.infer<typeof AiTestGenerationModeSchema>;

const ProjectRelativeFileSchema = z
  .string()
  .min(1)
  .refine(noFlagInjection, "target file must not start with '-'")
  .refine((value) => !value.includes(".."), "target file must not contain '..'")
  .refine((value) => !absolutePathLike(value), "target file must be project-relative");

export const AiTestGenerationRequestSchema = z.object({
  provider: AiAnalysisProviderSchema.optional().default("claude-code"),
  mode: AiTestGenerationModeSchema.optional().default("generator"),
  objective: z.string().min(1),
  targetFiles: z.array(ProjectRelativeFileSchema).default([])
});
export type AiTestGenerationRequest = z.input<typeof AiTestGenerationRequestSchema>;

export const AiTestGenerationContextSchema = z.object({
  mode: AiTestGenerationModeSchema,
  objective: z.string(),
  targetFiles: z.array(ProjectRelativeFileSchema),
  analysisContext: AiAnalysisContextSchema
});
export type AiTestGenerationContext = z.infer<typeof AiTestGenerationContextSchema>;

export const AiTestGenerationOutputSchema = z.object({
  plan: z.array(z.string()),
  proposedPatch: z.string().optional(),
  filesTouched: z.array(ProjectRelativeFileSchema),
  evidence: z.array(z.string()),
  risk: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  requiresHumanDecision: z.boolean()
});
export type AiTestGenerationOutput = z.infer<typeof AiTestGenerationOutputSchema>;

export const AiTestGenerationResponseSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  provider: AiAnalysisProviderSchema,
  mode: AiTestGenerationModeSchema,
  generatedAt: z.string(),
  result: AiTestGenerationOutputSchema,
  warnings: z.array(z.string())
});
export type AiTestGenerationResponse = z.infer<typeof AiTestGenerationResponseSchema>;

export const PatchRequestSchema = z.object({
  projectId: z.string(),
  patch: z.string().min(1)
});
export type PatchRequest = z.infer<typeof PatchRequestSchema>;

export const PatchCheckResponseSchema = z.object({
  ok: z.boolean(),
  filesTouched: z.array(z.string()),
  dirtyFiles: z.array(z.string()),
  diagnostics: z.string(),
  reason: z
    .enum(["dirty-worktree", "apply-check-failed"])
    .optional()
});
export type PatchCheckResponse = z.infer<typeof PatchCheckResponseSchema>;

export const PatchApplyResponseSchema = z.object({
  applied: z.boolean(),
  filesTouched: z.array(z.string()),
  diagnostics: z.string()
});
export type PatchApplyResponse = z.infer<typeof PatchApplyResponseSchema>;

export const PatchRevertResponseSchema = z.object({
  reverted: z.boolean(),
  filesTouched: z.array(z.string()),
  diagnostics: z.string()
});
export type PatchRevertResponse = z.infer<typeof PatchRevertResponseSchema>;

export const RepairComparisonVerdictSchema = z.enum([
  "fixed",
  "improved",
  "unchanged",
  "regressed",
  "inconclusive"
]);
export type RepairComparisonVerdict = z.infer<typeof RepairComparisonVerdictSchema>;

export const RepairComparisonArtifactLinksSchema = z.object({
  runDir: z.string(),
  playwrightHtml: z.string(),
  allureReportDir: z.string(),
  qmoSummaryJsonPath: z.string()
});
export type RepairComparisonArtifactLinks = z.infer<
  typeof RepairComparisonArtifactLinksSchema
>;

export const RepairComparisonDeltaSchema = z.object({
  total: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  flaky: z.number().int()
});
export type RepairComparisonDelta = z.infer<typeof RepairComparisonDeltaSchema>;

export const RepairFailureComparisonSchema = z.object({
  key: z.string(),
  title: z.string(),
  before: FailedTestSchema.optional(),
  after: FailedTestSchema.optional()
});
export type RepairFailureComparison = z.infer<typeof RepairFailureComparisonSchema>;

export const RepairComparisonSchema = z.object({
  baselineRunId: z.string(),
  rerunId: z.string(),
  generatedAt: z.string(),
  verdict: RepairComparisonVerdictSchema,
  before: z.object({
    status: RunStatusSchema,
    summary: TestResultSummarySchema.optional()
  }),
  after: z.object({
    status: RunStatusSchema,
    summary: TestResultSummarySchema.optional()
  }),
  delta: RepairComparisonDeltaSchema.optional(),
  resolvedFailures: z.array(RepairFailureComparisonSchema),
  remainingFailures: z.array(RepairFailureComparisonSchema),
  newFailures: z.array(RepairFailureComparisonSchema),
  artifacts: z.object({
    before: RepairComparisonArtifactLinksSchema,
    after: RepairComparisonArtifactLinksSchema
  }),
  warnings: z.array(z.string())
});
export type RepairComparison = z.infer<typeof RepairComparisonSchema>;

export const RepairRerunResponseSchema = z.object({
  baselineRunId: z.string(),
  rerunId: z.string(),
  status: z.literal("queued"),
  comparisonPath: z.string()
});
export type RepairRerunResponse = z.infer<typeof RepairRerunResponseSchema>;

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
