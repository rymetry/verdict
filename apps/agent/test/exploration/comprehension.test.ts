import { describe, expect, it } from "vitest";
import { createScreenModelComprehender } from "../../src/exploration/comprehension.js";
import type { ExplorationScreenModelDraft } from "@pwqa/shared";

describe("createScreenModelComprehender", () => {
  it("annotates explored steps and flows with business semantics", () => {
    const comprehender = createScreenModelComprehender({
      now: () => new Date("2026-05-02T00:00:00.000Z")
    });

    const annotated = comprehender.comprehend(screenModelDraft());

    expect(annotated.comprehension).toEqual({
      generatedAt: "2026-05-02T00:00:00.000Z",
      strategy: "heuristic",
      warnings: []
    });
    expect(annotated.steps[0]?.semanticAnnotations.map((entry) => entry.kind)).toContain(
      "authentication"
    );
    expect(annotated.steps[1]?.semanticAnnotations.map((entry) => entry.kind)).toContain("payment");
    expect(annotated.steps[1]?.businessMeaning).toBe("Likely payment flow.");
    expect(annotated.observedFlows[0]?.description).toBe("Checkout with saved card");
    expect(annotated.observedFlows[0]?.triggers).toEqual([
      "fill Email",
      "click Pay with saved card"
    ]);
    expect(annotated.semantics.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(["authentication", "payment", "form"])
    );
  });

  it("deduplicates semantic annotations while preserving evidence step ids", () => {
    const comprehender = createScreenModelComprehender({
      now: () => new Date("2026-05-02T00:00:00.000Z")
    });

    const annotated = comprehender.comprehend({
      ...screenModelDraft(),
      steps: [
        {
          stepId: "step-a",
          action: "click",
          target: { text: "Pay now" },
          domSnapshot: "<button>Pay now</button>",
          networkEvents: []
        },
        {
          stepId: "step-b",
          action: "click",
          target: { text: "Pay invoice" },
          domSnapshot: "<button>Pay invoice</button>",
          networkEvents: []
        }
      ],
      observedFlows: [
        {
          flowId: "flow-payment",
          title: "Payment",
          stepIds: ["step-a", "step-b"]
        }
      ]
    });

    const payment = annotated.semantics.find((entry) => entry.kind === "payment");
    expect(payment?.evidenceStepIds).toEqual(["step-a", "step-b"]);
  });
});

function screenModelDraft(): ExplorationScreenModelDraft {
  return {
    startUrl: "https://example.test/checkout",
    provider: "stagehand",
    generatedAt: "2026-05-02T00:00:00.000Z",
    steps: [
      {
        stepId: "step-1",
        action: "fill",
        target: { role: "textbox", text: "Email" },
        data: "user@example.test",
        domSnapshot: '<input type="email" name="email" />',
        networkEvents: []
      },
      {
        stepId: "step-2",
        action: "click",
        target: { role: "button", text: "Pay with saved card" },
        domSnapshot: "<button>Pay with saved card</button><div>Checkout complete</div>",
        networkEvents: [{ method: "POST", url: "/api/payments", status: 200 }]
      }
    ],
    observedFlows: [
      {
        flowId: "flow-1",
        title: "Checkout with saved card",
        stepIds: ["step-1", "step-2"]
      }
    ],
    unclear: [],
    warnings: []
  };
}
