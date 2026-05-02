import type { AiTestGenerationOutput } from "@pwqa/shared";
import type { TestPlanResult } from "../ai/testPlan.js";

export interface PlanDrivenRepairInput {
  testPlan: TestPlanResult;
  generation: AiTestGenerationOutput;
  objective?: string;
}

export interface PlanDrivenRepairReview {
  approvalPolicy: "plan-driven-repair-review";
  objective: string;
  planMarkdown: string;
  proposedPatch?: string;
  filesTouched: string[];
  checklist: string[];
  evidence: string[];
  risk: string[];
  warnings: string[];
  requiresHumanDecision: boolean;
}

export function buildPlanDrivenRepairReview(input: PlanDrivenRepairInput): PlanDrivenRepairReview {
  const warnings = [...input.testPlan.warnings];
  if (!input.generation.proposedPatch) {
    warnings.push("Generated test output did not include a patch for Repair Review.");
  }
  if (input.generation.filesTouched.length === 0) {
    warnings.push("Generated test output did not identify files touched.");
  }

  return {
    approvalPolicy: "plan-driven-repair-review",
    objective: input.objective?.trim() || "Review the generated patch against the test plan.",
    planMarkdown: input.testPlan.markdown,
    proposedPatch: input.generation.proposedPatch,
    filesTouched: dedupe(input.generation.filesTouched),
    checklist: buildChecklist(input),
    evidence: dedupe(input.generation.evidence),
    risk: dedupe(input.generation.risk),
    warnings: dedupe(warnings),
    requiresHumanDecision:
      input.generation.requiresHumanDecision ||
      warnings.length > 0 ||
      input.generation.confidence < 0.7
  };
}

function buildChecklist(input: PlanDrivenRepairInput): string[] {
  const planItems = input.generation.plan.map((item) => `Generated plan: ${item}`);
  const fileItems = input.generation.filesTouched.map((file) => `Patch touches ${file}`);
  const confidence = `Generation confidence: ${Math.round(input.generation.confidence * 100)}%`;
  return dedupe([
    "Patch applies cleanly with git apply --check before temporary apply.",
    "Rerun uses the same baseline request so before/after comparison is meaningful.",
    ...planItems,
    ...fileItems,
    confidence
  ]);
}

function dedupe(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
