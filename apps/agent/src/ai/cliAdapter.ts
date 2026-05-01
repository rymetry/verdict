import {
  AiAnalysisOutputSchema,
  AiTestGenerationOutputSchema,
  type AiAnalysisContext,
  type AiAnalysisOutput,
  type AiAnalysisProvider,
  type AiTestGenerationContext,
  type AiTestGenerationOutput
} from "@pwqa/shared";
import type { CommandRunner } from "../commands/runner.js";

const AI_ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;

const AI_OUTPUT_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "classification",
    "rootCause",
    "evidence",
    "risk",
    "filesTouched",
    "confidence",
    "requiresHumanDecision"
  ],
  properties: {
    classification: {
      type: "string",
      enum: ["product-bug", "test-bug", "environment", "flaky", "unknown"]
    },
    rootCause: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    risk: { type: "array", items: { type: "string" } },
    proposedPatch: { type: "string" },
    filesTouched: { type: "array", items: { type: "string" } },
    rerunCommand: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    requiresHumanDecision: { type: "boolean" }
  }
});

const AI_TEST_GENERATION_OUTPUT_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["plan", "filesTouched", "evidence", "risk", "confidence", "requiresHumanDecision"],
  properties: {
    plan: { type: "array", items: { type: "string" } },
    proposedPatch: { type: "string" },
    filesTouched: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
    risk: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    requiresHumanDecision: { type: "boolean" }
  }
});

export class AiAnalysisError extends Error {
  constructor(
    message: string,
    readonly code:
      | "AI_CLI_FAILED"
      | "AI_CLI_OUTPUT_INVALID"
      | "AI_CLI_TIMED_OUT"
      | "AI_CLI_CANCELLED"
  ) {
    super(message);
    this.name = "AiAnalysisError";
  }
}

export interface AnalyzeWithAiInput {
  provider: AiAnalysisProvider;
  projectRoot: string;
  context: AiAnalysisContext;
}

export interface GenerateTestsWithAiInput {
  provider: AiAnalysisProvider;
  projectRoot: string;
  context: AiTestGenerationContext;
}

export interface AiAnalysisAdapter {
  analyze(input: AnalyzeWithAiInput): Promise<AiAnalysisOutput>;
  generateTests?(input: GenerateTestsWithAiInput): Promise<AiTestGenerationOutput>;
}

export function createAiCliAdapter(runner: CommandRunner): AiAnalysisAdapter {
  return {
    async analyze(input) {
      const schema = JSON.stringify(AI_OUTPUT_JSON_SCHEMA);
      const handle = runner.run(
        {
          executable: executableFor(input.provider),
          args: argsFor(input.provider, schema),
          cwd: input.projectRoot,
          timeoutMs: AI_ANALYSIS_TIMEOUT_MS,
          label: `ai-analysis:${input.provider}`,
          stdin: buildPrompt(input.context)
        }
      );
      const result = await handle.result;
      if (result.timedOut) {
        throw new AiAnalysisError("AI CLI timed out before returning analysis.", "AI_CLI_TIMED_OUT");
      }
      if (result.cancelled) {
        throw new AiAnalysisError("AI CLI run was cancelled.", "AI_CLI_CANCELLED");
      }
      if (result.exitCode !== 0) {
        throw new AiAnalysisError("AI CLI exited with a non-zero status.", "AI_CLI_FAILED");
      }
      return parseAiOutput(result.stdout);
    },
    async generateTests(input) {
      const schema = JSON.stringify(AI_TEST_GENERATION_OUTPUT_JSON_SCHEMA);
      const handle = runner.run(
        {
          executable: executableFor(input.provider),
          args: argsFor(input.provider, schema),
          cwd: input.projectRoot,
          timeoutMs: AI_ANALYSIS_TIMEOUT_MS,
          label: `ai-test-generation:${input.provider}`,
          stdin: buildTestGenerationPrompt(input.context)
        }
      );
      const result = await handle.result;
      if (result.timedOut) {
        throw new AiAnalysisError("AI CLI timed out before returning generated tests.", "AI_CLI_TIMED_OUT");
      }
      if (result.cancelled) {
        throw new AiAnalysisError("AI CLI run was cancelled.", "AI_CLI_CANCELLED");
      }
      if (result.exitCode !== 0) {
        throw new AiAnalysisError("AI CLI exited with a non-zero status.", "AI_CLI_FAILED");
      }
      return parseAiTestGenerationOutput(result.stdout);
    }
  };
}

function executableFor(provider: AiAnalysisProvider): string {
  switch (provider) {
    case "claude-code":
      return "claude";
  }
}

function argsFor(provider: AiAnalysisProvider, schema: string): string[] {
  switch (provider) {
    case "claude-code":
      return [
        "--bare",
        "--print",
        "--input-format",
        "text",
        "--output-format",
        "json",
        "--tools",
        "",
        "--no-session-persistence",
        "--json-schema",
        schema
      ];
  }
}

function buildPrompt(context: AiAnalysisContext): string {
  return [
    "Analyze this Playwright failure context.",
    "Return only the structured JSON object requested by the schema.",
    "Do not edit files, run commands, or request additional tools.",
    "If evidence is insufficient, set classification to unknown and requiresHumanDecision to true.",
    "",
    JSON.stringify({ context }, null, 2)
  ].join("\n");
}

function buildTestGenerationPrompt(context: AiTestGenerationContext): string {
  return [
    "Plan or generate Playwright tests from this Workbench context.",
    "Return only the structured JSON object requested by the schema.",
    "Do not edit files, run commands, or request additional tools.",
    "If you propose changes, put them in proposedPatch as a unified git diff.",
    "If evidence is insufficient, leave proposedPatch undefined and set requiresHumanDecision to true.",
    "",
    JSON.stringify({ context }, null, 2)
  ].join("\n");
}

function parseAiOutput(stdout: string): AiAnalysisOutput {
  const parsed = parseJson(stdout);
  const candidates = [
    parsed,
    typeof parsed === "object" && parsed !== null ? (parsed as { result?: unknown }).result : undefined
  ];
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? parseJson(candidate) : candidate;
    const validated = AiAnalysisOutputSchema.safeParse(value);
    if (validated.success) return validated.data;
  }
  throw new AiAnalysisError("AI CLI output did not match AiAnalysisOutputSchema.", "AI_CLI_OUTPUT_INVALID");
}

function parseAiTestGenerationOutput(stdout: string): AiTestGenerationOutput {
  const parsed = parseJson(stdout);
  const candidates = [
    parsed,
    typeof parsed === "object" && parsed !== null ? (parsed as { result?: unknown }).result : undefined
  ];
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? parseJson(candidate) : candidate;
    const validated = AiTestGenerationOutputSchema.safeParse(value);
    if (validated.success) return validated.data;
  }
  throw new AiAnalysisError("AI CLI output did not match AiTestGenerationOutputSchema.", "AI_CLI_OUTPUT_INVALID");
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new AiAnalysisError("AI CLI output was not valid JSON.", "AI_CLI_OUTPUT_INVALID");
  }
}
