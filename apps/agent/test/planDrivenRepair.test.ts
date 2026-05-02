import { describe, expect, it } from "vitest";
import type { AiTestGenerationOutput } from "@pwqa/shared";
import { buildPlanDrivenRepairReview } from "../src/repair/planDrivenRepair.js";
import type { TestPlanResult } from "../src/ai/testPlan.js";

describe("buildPlanDrivenRepairReview", () => {
  it("builds a repair review context from test plan and generated patch output", () => {
    const review = buildPlanDrivenRepairReview({
      objective: "Validate checkout regression repair.",
      testPlan: makeTestPlan(),
      generation: makeGeneration()
    });

    expect(review).toEqual({
      approvalPolicy: "plan-driven-repair-review",
      objective: "Validate checkout regression repair.",
      planMarkdown: "# Test Plan\n\n## Proposed Tests\n",
      proposedPatch: "diff --git a/tests/checkout.spec.ts b/tests/checkout.spec.ts\n",
      filesTouched: ["tests/checkout.spec.ts"],
      checklist: [
        "Patch applies cleanly with git apply --check before temporary apply.",
        "Rerun uses the same baseline request so before/after comparison is meaningful.",
        "Generated plan: Cover guest checkout",
        "Generated plan: Assert payment failure copy",
        "Patch touches tests/checkout.spec.ts",
        "Generation confidence: 82%"
      ],
      evidence: ["failure context references checkout"],
      risk: ["test-only change"],
      warnings: [],
      requiresHumanDecision: false
    });
  });

  it("requires human decision when generated output lacks a patch or confidence is low", () => {
    const review = buildPlanDrivenRepairReview({
      testPlan: makeTestPlan({ warnings: ["Missing layer judgments for flows: checkout."] }),
      generation: makeGeneration({
        proposedPatch: undefined,
        filesTouched: [],
        confidence: 0.55,
        requiresHumanDecision: false
      })
    });

    expect(review.requiresHumanDecision).toBe(true);
    expect(review.warnings).toEqual([
      "Missing layer judgments for flows: checkout.",
      "Generated test output did not include a patch for Repair Review.",
      "Generated test output did not identify files touched."
    ]);
    expect(review.objective).toBe("Review the generated patch against the test plan.");
  });
});

function makeTestPlan(overrides: Partial<TestPlanResult> = {}): TestPlanResult {
  return {
    generatedAt: "2026-05-02T00:00:00.000Z",
    strategy: "heuristic",
    markdown: "# Test Plan\n\n## Proposed Tests\n",
    warnings: [],
    ...overrides
  };
}

function makeGeneration(overrides: Partial<AiTestGenerationOutput> = {}): AiTestGenerationOutput {
  return {
    plan: ["Cover guest checkout", "Assert payment failure copy"],
    proposedPatch: "diff --git a/tests/checkout.spec.ts b/tests/checkout.spec.ts\n",
    filesTouched: ["tests/checkout.spec.ts"],
    evidence: ["failure context references checkout"],
    risk: ["test-only change"],
    confidence: 0.82,
    requiresHumanDecision: false,
    ...overrides
  };
}
