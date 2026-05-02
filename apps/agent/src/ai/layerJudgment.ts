import {
  LayerJudgmentResultSchema,
  type AnnotatedObservedFlow,
  type AnnotatedScreenModel,
  type ExplorationSemanticKind,
  type LayerJudgment,
  type LayerJudgmentResult,
  type TestLayer
} from "@pwqa/shared";

export interface LayerJudgmentAdvisorOptions {
  now?: () => Date;
}

export interface LayerJudgmentAdvisor {
  judge(screenModel: AnnotatedScreenModel): LayerJudgmentResult;
}

export function createLayerJudgmentAdvisor(
  options: LayerJudgmentAdvisorOptions = {}
): LayerJudgmentAdvisor {
  const now = options.now ?? (() => new Date());
  return {
    judge(screenModel) {
      const judgments = screenModel.observedFlows.map((flow) =>
        judgeFlow(flow, semanticKindsForFlow(screenModel, flow))
      );
      return LayerJudgmentResultSchema.parse({
        generatedAt: now().toISOString(),
        strategy: "heuristic",
        judgments,
        warnings: []
      });
    }
  };
}

function judgeFlow(
  flow: AnnotatedObservedFlow,
  semantics: ReadonlySet<ExplorationSemanticKind>
): LayerJudgment {
  if (semantics.has("payment")) {
    return judgment({
      flow,
      recommended: "e2e",
      confidence: 0.82,
      rationale:
        "Payment and checkout behavior crosses UI, backend, and external-service boundaries.",
      alternativeLayers: ["integration", "contract"],
      riskIfWrong: "high"
    });
  }
  if (semantics.has("authentication")) {
    return judgment({
      flow,
      recommended: "e2e",
      confidence: 0.76,
      rationale: "Authentication is a user-critical cross-boundary flow.",
      alternativeLayers: ["integration", "contract"],
      riskIfWrong: "high"
    });
  }
  if (semantics.has("navigation")) {
    return judgment({
      flow,
      recommended: "e2e",
      confidence: 0.62,
      rationale: "Navigation value comes from verifying user-visible routes and state transitions.",
      alternativeLayers: ["integration"],
      riskIfWrong: "medium"
    });
  }
  if (semantics.has("form")) {
    return judgment({
      flow,
      recommended: "integration",
      confidence: 0.68,
      rationale: "Form behavior is usually best covered at component plus API-stub level first.",
      alternativeLayers: ["e2e", "unit"],
      riskIfWrong: "medium"
    });
  }
  if (flow.stepIds.length <= 1) {
    return judgment({
      flow,
      recommended: "unit",
      confidence: 0.55,
      rationale: "Single-step behavior appears isolated enough for a focused unit test.",
      alternativeLayers: ["integration"],
      riskIfWrong: "low"
    });
  }
  return judgment({
    flow,
    recommended: "manual",
    confidence: 0.45,
    rationale: "Insufficient semantics to safely choose an automated layer.",
    alternativeLayers: ["e2e", "integration"],
    riskIfWrong: "medium"
  });
}

function semanticKindsForFlow(
  screenModel: AnnotatedScreenModel,
  flow: AnnotatedObservedFlow
): ReadonlySet<ExplorationSemanticKind> {
  const stepKinds = screenModel.steps
    .filter((step) => flow.stepIds.includes(step.stepId))
    .flatMap((step) => step.semanticAnnotations.map((annotation) => annotation.kind));
  return new Set([
    ...flow.semanticAnnotations.map((annotation) => annotation.kind),
    ...stepKinds
  ]);
}

function judgment(input: {
  flow: AnnotatedObservedFlow;
  recommended: TestLayer;
  confidence: number;
  rationale: string;
  alternativeLayers: TestLayer[];
  riskIfWrong: "low" | "medium" | "high";
}): LayerJudgment {
  return {
    flowId: input.flow.flowId,
    recommended: input.recommended,
    confidence: input.confidence,
    rationale: input.rationale,
    alternativeLayers: input.alternativeLayers,
    riskIfWrong: input.riskIfWrong,
    evidenceStepIds: input.flow.stepIds
  };
}
