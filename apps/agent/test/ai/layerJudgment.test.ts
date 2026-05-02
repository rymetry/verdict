import { describe, expect, it } from "vitest";
import { createLayerJudgmentAdvisor } from "../../src/ai/layerJudgment.js";
import type { AnnotatedScreenModel, ExplorationSemanticAnnotation } from "@pwqa/shared";

describe("createLayerJudgmentAdvisor", () => {
  it("recommends e2e for payment flows", () => {
    const advisor = createLayerJudgmentAdvisor({
      now: () => new Date("2026-05-02T00:00:00.000Z")
    });

    const result = advisor.judge(screenModelWithFlow("payment"));

    expect(result.generatedAt).toBe("2026-05-02T00:00:00.000Z");
    expect(result.strategy).toBe("heuristic");
    expect(result.judgments[0]).toMatchObject({
      flowId: "flow-1",
      recommended: "e2e",
      riskIfWrong: "high",
      evidenceStepIds: ["step-1", "step-2"]
    });
    expect(result.judgments[0]?.alternativeLayers).toEqual(["integration", "contract"]);
  });

  it("recommends integration for form-only flows", () => {
    const advisor = createLayerJudgmentAdvisor();

    const result = advisor.judge(screenModelWithFlow("form"));

    expect(result.judgments[0]).toMatchObject({
      recommended: "integration",
      riskIfWrong: "medium"
    });
    expect(result.judgments[0]?.alternativeLayers).toEqual(["e2e", "unit"]);
  });

  it("recommends e2e for mixed form and navigation flows", () => {
    const advisor = createLayerJudgmentAdvisor();

    const result = advisor.judge(screenModelWithFlow("form-navigation"));

    expect(result.judgments[0]).toMatchObject({
      recommended: "e2e",
      riskIfWrong: "medium"
    });
    expect(result.judgments[0]?.rationale).toContain("Navigation");
  });

  it("falls back to manual when semantics are insufficient", () => {
    const advisor = createLayerJudgmentAdvisor();

    const result = advisor.judge({
      ...screenModelWithFlow("unknown"),
      observedFlows: [
        {
          flowId: "flow-unknown",
          title: "Unknown multi-step flow",
          stepIds: ["step-1", "step-2"],
          triggers: [],
          outcomes: [],
          semanticAnnotations: []
        }
      ],
      steps: screenModelWithFlow("unknown").steps.map((step) => ({
        ...step,
        semanticAnnotations: []
      }))
    });

    expect(result.judgments[0]).toMatchObject({
      flowId: "flow-unknown",
      recommended: "manual",
      riskIfWrong: "medium"
    });
  });
});

function screenModelWithFlow(
  kind: "payment" | "form" | "form-navigation" | "unknown"
): AnnotatedScreenModel {
  const annotations: ExplorationSemanticAnnotation[] =
    kind === "unknown"
      ? []
      : [
          {
            kind: kind === "payment" ? "payment" : "form",
            label: kind === "payment" ? "payment flow" : "form interaction",
            confidence: 0.8,
            evidenceStepIds: ["step-1"]
          },
          ...(kind === "form-navigation"
            ? [
                {
                  kind: "navigation" as const,
                  label: "navigation",
                  confidence: 0.68,
                  evidenceStepIds: ["step-2"]
                }
              ]
            : [])
        ];

  return {
    startUrl: "https://example.test",
    provider: "stagehand",
    generatedAt: "2026-05-02T00:00:00.000Z",
    steps: [
      {
        stepId: "step-1",
        action: "fill",
        target: { text: kind === "payment" ? "Card number" : "Email" },
        domSnapshot: "<input />",
        networkEvents: [],
        semanticAnnotations: annotations.filter((annotation) => annotation.evidenceStepIds.includes("step-1"))
      },
      {
        stepId: "step-2",
        action: "click",
        target: { text: kind === "payment" ? "Pay" : "Submit" },
        domSnapshot: "<button>Submit</button>",
        networkEvents: [],
        semanticAnnotations: annotations.filter((annotation) => annotation.evidenceStepIds.includes("step-2"))
      }
    ],
    observedFlows: [
      {
        flowId: "flow-1",
        title: "Flow",
        stepIds: ["step-1", "step-2"],
        triggers: [],
        outcomes: [],
        semanticAnnotations: annotations
      }
    ],
    semantics: annotations,
    unclear: [],
    warnings: [],
    comprehension: {
      generatedAt: "2026-05-02T00:00:00.000Z",
      strategy: "heuristic",
      warnings: []
    }
  };
}
