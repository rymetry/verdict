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

/**
 * Inputs that flow to the Playwright CLI must not be allowed to act as
 * additional flags (PLAN.v2 §28 / security review). A bare leading `-`
 * is rejected; `..` and absolute paths are rejected for `specPath`.
 */
const noFlagInjection = (value: string): boolean => !value.startsWith("-");

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
  headed: z.boolean().optional().default(false)
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
  artifactsJson: z.string()
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

/* ----------------------------------------------------------------------- */
/* WebSocket event envelope (PLAN.v2 §20)                                  */
/* ----------------------------------------------------------------------- */

export const RunStdStreamPayloadSchema = z.object({
  chunk: z.string()
});
export type RunStdStreamPayload = z.infer<typeof RunStdStreamPayloadSchema>;

export const RunCompletedPayloadSchema = z.object({
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable().optional(),
  status: RunStatusSchema,
  durationMs: z.number().int().nonnegative(),
  summary: TestResultSummarySchema.optional(),
  warnings: z.array(z.string()).default([])
});
export type RunCompletedPayload = z.infer<typeof RunCompletedPayloadSchema>;

export const RunErrorPayloadSchema = RunCompletedPayloadSchema.extend({
  message: z.string()
});
export type RunErrorPayload = z.infer<typeof RunErrorPayloadSchema>;

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

export const WorkbenchEventSchema = z.object({
  type: WorkbenchEventTypeSchema,
  sequence: z.number().int().nonnegative(),
  timestamp: z.string(),
  runId: z.string().optional(),
  payload: z.unknown()
});
export type WorkbenchEvent = z.infer<typeof WorkbenchEventSchema>;

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
