import type {
  AnnotatedObservedFlow,
  AnnotatedScreenModel,
  LayerJudgment,
  LayerJudgmentResult
} from "@pwqa/shared";

export interface TestPlanGeneratorOptions {
  now?: () => Date;
}

export interface TestPlanInput {
  screenModel: AnnotatedScreenModel;
  layerJudgment: LayerJudgmentResult;
  objective?: string;
}

export interface TestPlanResult {
  generatedAt: string;
  strategy: "heuristic";
  markdown: string;
  warnings: string[];
}

export interface TestPlanGenerator {
  generate(input: TestPlanInput): TestPlanResult;
}

export function createTestPlanGenerator(
  options: TestPlanGeneratorOptions = {}
): TestPlanGenerator {
  const now = options.now ?? (() => new Date());
  return {
    generate(input) {
      const generatedAt = now().toISOString();
      const warnings = validateInput(input);
      return {
        generatedAt,
        strategy: "heuristic",
        markdown: renderMarkdown(input, generatedAt, warnings),
        warnings
      };
    }
  };
}

function validateInput(input: TestPlanInput): string[] {
  const warnings: string[] = [];
  if (input.screenModel.observedFlows.length === 0) {
    warnings.push("No observed flows are available for test planning.");
  }
  const flowIds = new Set(input.screenModel.observedFlows.map((flow) => flow.flowId));
  const missingJudgments = input.screenModel.observedFlows
    .map((flow) => flow.flowId)
    .filter((flowId) => !input.layerJudgment.judgments.some((judgment) => judgment.flowId === flowId));
  if (missingJudgments.length > 0) {
    warnings.push(`Missing layer judgments for flows: ${missingJudgments.join(", ")}.`);
  }
  const orphanJudgments = input.layerJudgment.judgments
    .map((judgment) => judgment.flowId)
    .filter((flowId) => !flowIds.has(flowId));
  if (orphanJudgments.length > 0) {
    warnings.push(`Layer judgments reference unknown flows: ${orphanJudgments.join(", ")}.`);
  }
  return warnings;
}

function renderMarkdown(input: TestPlanInput, generatedAt: string, warnings: string[]): string {
  const flowById = new Map(
    input.screenModel.observedFlows.map((flow): [string, AnnotatedObservedFlow] => [
      flow.flowId,
      flow
    ])
  );
  const lines: string[] = [
    "# Test Plan",
    "",
    `Generated: ${generatedAt}`,
    `Strategy: ${input.layerJudgment.strategy}`,
    "",
    "## Objective",
    "",
    input.objective?.trim() || "Validate observed user flows with the lowest reliable test layer.",
    "",
    "## Coverage Strategy",
    "",
    "| Flow | Layer | Confidence | Risk | Rationale |",
    "|---|---:|---:|---:|---|"
  ];

  for (const judgment of input.layerJudgment.judgments) {
    const flow = flowById.get(judgment.flowId);
    lines.push(
      `|${[
        tableCell(flow?.title ?? judgment.flowId),
        tableCell(judgment.recommended),
        tableCell(formatConfidence(judgment.confidence)),
        tableCell(judgment.riskIfWrong),
        tableCell(judgment.rationale)
      ].join("|")}|`
    );
  }

  lines.push("", "## Proposed Tests", "");
  for (const judgment of input.layerJudgment.judgments) {
    const flow = flowById.get(judgment.flowId);
    lines.push(...renderProposedTest(judgment, flow));
  }

  lines.push("", "## Clarifications", "");
  const clarificationLines = input.screenModel.unclear.map(
    (request) =>
      `- ${request.blocking ? "[blocking]" : "[non-blocking]"} ${request.question} (${request.reason})`
  );
  lines.push(...(clarificationLines.length > 0 ? clarificationLines : ["- None."]));

  if (warnings.length > 0) {
    lines.push("", "## Warnings", "", ...warnings.map((warning) => `- ${warning}`));
  }

  return `${lines.join("\n")}\n`;
}

function renderProposedTest(
  judgment: LayerJudgment,
  flow: AnnotatedObservedFlow | undefined
): string[] {
  const title = flow?.title ?? judgment.flowId;
  const outcomes = flow?.outcomes ?? [];
  const triggers = flow?.triggers ?? [];
  const lines = [
    `### ${title}`,
    "",
    `- Layer: ${judgment.recommended}`,
    `- Risk if wrong: ${judgment.riskIfWrong}`,
    `- Evidence steps: ${judgment.evidenceStepIds.join(", ") || "none"}`,
    `- Primary assertion: ${outcomes[0] ?? "The flow completes with the expected user-visible result."}`
  ];
  if (triggers.length > 0) {
    lines.push(`- Trigger: ${triggers[0]}`);
  }
  if (judgment.alternativeLayers.length > 0) {
    lines.push(`- Alternatives: ${judgment.alternativeLayers.join(", ")}`);
  }
  lines.push("");
  return lines;
}

function tableCell(value: string): string {
  return ` ${value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()} `;
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}
