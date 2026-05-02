import { describe, expect, it } from "vitest";
import { createTestPlanGenerator } from "../../src/ai/testPlan.js";
import type { AnnotatedScreenModel, LayerJudgmentResult } from "@pwqa/shared";

describe("createTestPlanGenerator", () => {
  it("renders a Markdown plan from screen model and layer judgments", () => {
    const generator = createTestPlanGenerator({
      now: () => new Date("2026-05-02T00:00:00.000Z")
    });

    const result = generator.generate({
      screenModel: screenModel(),
      layerJudgment: layerJudgment(),
      objective: "Cover checkout behavior before release."
    });

    expect(result).toMatchObject({
      generatedAt: "2026-05-02T00:00:00.000Z",
      strategy: "heuristic",
      warnings: []
    });
    expect(result.markdown).toContain("# Test Plan");
    expect(result.markdown).toContain("Cover checkout behavior before release.");
    expect(result.markdown).toContain("| Checkout | e2e | 82% | high | Payment crosses UI and backend boundaries. |");
    expect(result.markdown).toContain("### Checkout");
    expect(result.markdown).toContain("- Primary assertion: Receipt is shown.");
    expect(result.markdown).toContain("- Alternatives: integration, contract");
    expect(result.markdown).toContain("- None.");
  });

  it("includes blocking clarifications and warnings for incomplete judgment coverage", () => {
    const generator = createTestPlanGenerator({
      now: () => new Date("2026-05-02T00:00:00.000Z")
    });
    const model = {
      ...screenModel(),
      unclear: [
        {
          question: "Which card brands must be covered?",
          reason: "Payment support is unclear.",
          blocking: true
        }
      ]
    };

    const result = generator.generate({
      screenModel: model,
      layerJudgment: {
        generatedAt: "2026-05-02T00:00:00.000Z",
        strategy: "heuristic",
        judgments: [],
        warnings: []
      }
    });

    expect(result.warnings).toEqual(["Missing layer judgments for flows: checkout."]);
    expect(result.markdown).toContain("- [blocking] Which card brands must be covered? (Payment support is unclear.)");
    expect(result.markdown).toContain("## Warnings");
    expect(result.markdown).toContain("- Missing layer judgments for flows: checkout.");
  });
});

function screenModel(): AnnotatedScreenModel {
  return {
    provider: "browser-use",
    generatedAt: "2026-05-02T00:00:00.000Z",
    startUrl: "https://example.test/checkout",
    steps: [
      {
        stepId: "step-1",
        action: "navigate",
        domSnapshot: "<main>Checkout</main>",
        networkEvents: [],
        semanticAnnotations: [
          {
            kind: "payment",
            label: "checkout",
            confidence: 0.8,
            evidenceStepIds: ["step-1"]
          }
        ],
        businessMeaning: "Open checkout."
      }
    ],
    observedFlows: [
      {
        flowId: "checkout",
        title: "Checkout",
        stepIds: ["step-1"],
        description: "Customer completes checkout.",
        triggers: ["Customer submits payment."],
        outcomes: ["Receipt is shown."],
        semanticAnnotations: [
          {
            kind: "payment",
            label: "payment",
            confidence: 0.9,
            evidenceStepIds: ["step-1"]
          }
        ]
      }
    ],
    unclear: [],
    warnings: [],
    semantics: [],
    comprehension: {
      generatedAt: "2026-05-02T00:00:00.000Z",
      strategy: "heuristic",
      warnings: []
    }
  };
}

function layerJudgment(): LayerJudgmentResult {
  return {
    generatedAt: "2026-05-02T00:00:00.000Z",
    strategy: "heuristic",
    judgments: [
      {
        flowId: "checkout",
        recommended: "e2e",
        confidence: 0.82,
        rationale: "Payment crosses UI and backend boundaries.",
        alternativeLayers: ["integration", "contract"],
        riskIfWrong: "high",
        evidenceStepIds: ["step-1"]
      }
    ],
    warnings: []
  };
}
