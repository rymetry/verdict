import { z } from "zod";

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  service: z.literal("playwright-qa-workbench-agent"),
  version: z.string(),
  timestamp: z.string()
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const PackageManagerSchema = z.enum(["npm", "pnpm", "yarn", "bun"]);
export type PackageManager = z.infer<typeof PackageManagerSchema>;

export const DetectionConfidenceSchema = z.enum(["high", "medium", "low"]);

export const CommandTemplateSchema = z.object({
  executable: z.string(),
  args: z.array(z.string())
});
export type CommandTemplate = z.infer<typeof CommandTemplateSchema>;

export const DetectedPackageManagerSchema = z.object({
  name: PackageManagerSchema,
  confidence: DetectionConfidenceSchema,
  reason: z.string(),
  warnings: z.array(z.string()),
  lockfiles: z.array(z.string()),
  packageManagerField: z.string().optional(),
  commandTemplates: z.object({
    playwrightTest: CommandTemplateSchema,
    allure: CommandTemplateSchema.optional()
  }),
  binaryAvailability: z.record(z.string(), z.boolean())
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
  column: z.number().int().positive(),
  describePath: z.array(z.string()),
  tags: z.array(z.string()),
  locatorCount: z.number().int().nonnegative(),
  assertionCount: z.number().int().nonnegative(),
  steps: z.array(TestStepSchema)
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
  specFiles: z.array(SpecFileSchema),
  packageManager: DetectedPackageManagerSchema,
  hasAllurePlaywright: z.boolean(),
  hasAllureCli: z.boolean(),
  warnings: z.array(z.string())
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const TestInventorySchema = z.object({
  projectId: z.string(),
  specs: z.array(SpecFileSchema),
  totals: z.object({
    specFiles: z.number().int().nonnegative(),
    tests: z.number().int().nonnegative(),
    assertions: z.number().int().nonnegative(),
    locators: z.number().int().nonnegative()
  })
});
export type TestInventory = z.infer<typeof TestInventorySchema>;

export const RunStatusSchema = z.enum(["queued", "running", "passed", "failed", "cancelled", "error"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunRequestSchema = z.object({
  projectId: z.string(),
  specPath: z.string().optional(),
  testId: z.string().optional(),
  grep: z.string().optional(),
  projectNames: z.array(z.string()).optional(),
  headed: z.boolean().optional().default(false),
  includeAllure: z.boolean().optional().default(true)
});
export type RunRequest = z.infer<typeof RunRequestSchema>;

export const EvidenceArtifactSchema = z.object({
  kind: z.enum(["json", "html", "allure-results", "allure-report", "log", "trace", "screenshot", "video", "quality-gate", "qmo-summary"]),
  path: z.string(),
  label: z.string()
});
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;

export const RunMetadataSchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  projectRoot: z.string(),
  status: RunStatusSchema,
  startedAt: z.string(),
  completedAt: z.string().optional(),
  command: CommandTemplateSchema,
  exitCode: z.number().int().nullable().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  requested: RunRequestSchema,
  paths: z.object({
    runDir: z.string(),
    stdout: z.string(),
    stderr: z.string(),
    playwrightJson: z.string(),
    playwrightHtml: z.string(),
    allureResults: z.string(),
    allureReport: z.string(),
    qualityGate: z.string(),
    qmoSummaryJson: z.string(),
    qmoSummaryMarkdown: z.string()
  }),
  artifacts: z.array(EvidenceArtifactSchema),
  warnings: z.array(z.string())
});
export type RunMetadata = z.infer<typeof RunMetadataSchema>;

export const TestResultSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  flaky: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
  failedTests: z.array(z.object({
    title: z.string(),
    filePath: z.string().optional(),
    line: z.number().int().positive().optional(),
    status: z.string(),
    message: z.string().optional(),
    trace: z.string().optional()
  }))
});
export type TestResultSummary = z.infer<typeof TestResultSummarySchema>;

export const QualityGateResultSchema = z.object({
  status: z.enum(["passed", "failed", "skipped", "error"]),
  profile: z.string(),
  evaluatedAt: z.string(),
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  reportPath: z.string().optional(),
  warnings: z.array(z.string())
});
export type QualityGateResult = z.infer<typeof QualityGateResultSchema>;

export const QmoReleaseSummarySchema = z.object({
  runId: z.string(),
  generatedAt: z.string(),
  decision: z.enum(["ready", "not-ready", "conditional", "unknown"]),
  summary: z.string(),
  blockingFailures: z.array(z.string()),
  evidenceLinks: z.array(EvidenceArtifactSchema),
  qualityGate: QualityGateResultSchema.optional(),
  markdownPath: z.string().optional()
});
export type QmoReleaseSummary = z.infer<typeof QmoReleaseSummarySchema>;

export const WorkbenchEventSchema = z.object({
  type: z.string(),
  sequence: z.number().int().positive(),
  timestamp: z.string(),
  runId: z.string().optional(),
  payload: z.unknown()
});
export type WorkbenchEvent = z.infer<typeof WorkbenchEventSchema>;
