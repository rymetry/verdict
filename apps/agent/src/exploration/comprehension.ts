import {
  AnnotatedScreenModelSchema,
  type AnnotatedScreenModel,
  type ExplorationScreenModelDraft,
  type ExplorationSemanticAnnotation,
  type ExplorationSemanticKind
} from "@pwqa/shared";

export interface ScreenModelComprehenderOptions {
  now?: () => Date;
}

export interface ScreenModelComprehender {
  comprehend(screenModel: ExplorationScreenModelDraft): AnnotatedScreenModel;
}

interface SemanticRule {
  kind: ExplorationSemanticKind;
  label: string;
  confidence: number;
  pattern: RegExp;
}

const SEMANTIC_RULES: readonly SemanticRule[] = [
  {
    kind: "authentication",
    label: "authentication flow",
    confidence: 0.82,
    pattern: /\b(login|log in|sign in|signup|sign up|password|email)\b/i
  },
  {
    kind: "payment",
    label: "payment flow",
    confidence: 0.78,
    pattern: /\b(payment|pay|checkout|cart|card|stripe|billing|invoice)\b/i
  },
  {
    kind: "form",
    label: "form interaction",
    confidence: 0.72,
    pattern: /\b(form|input|textarea|select|submit|field)\b/i
  },
  {
    kind: "navigation",
    label: "navigation",
    confidence: 0.68,
    pattern: /\b(nav|menu|link|breadcrumb|tab|route|page)\b/i
  },
  {
    kind: "assertion",
    label: "observable outcome",
    confidence: 0.64,
    pattern: /\b(success|complete|completed|created|updated|error|warning|toast|modal)\b/i
  }
];

export function createScreenModelComprehender(
  options: ScreenModelComprehenderOptions = {}
): ScreenModelComprehender {
  const now = options.now ?? (() => new Date());
  return {
    comprehend(screenModel) {
      const annotatedSteps = screenModel.steps.map((step) => {
        const annotations = annotationsForStep(step.stepId, searchableStepText(step));
        return {
          ...step,
          semanticAnnotations: annotations,
          businessMeaning: businessMeaningFor(annotations)
        };
      });
      const stepAnnotations = new Map(
        annotatedSteps.map((step) => [step.stepId, step.semanticAnnotations])
      );
      const annotatedFlows = screenModel.observedFlows.map((flow) => {
        const annotations = uniqueAnnotations(
          flow.stepIds.flatMap((stepId) => stepAnnotations.get(stepId) ?? [])
        );
        return {
          ...flow,
          description: flow.title,
          triggers: triggerHintsFor(flow.stepIds, annotatedSteps),
          outcomes: outcomeHintsFor(flow.stepIds, annotatedSteps),
          semanticAnnotations: annotations
        };
      });
      const semantics = uniqueAnnotations(
        annotatedSteps.flatMap((step) => step.semanticAnnotations)
      );

      return AnnotatedScreenModelSchema.parse({
        ...screenModel,
        steps: annotatedSteps,
        observedFlows: annotatedFlows,
        semantics,
        comprehension: {
          generatedAt: now().toISOString(),
          strategy: "heuristic",
          warnings: []
        }
      });
    }
  };
}

function annotationsForStep(
  stepId: string,
  text: string
): readonly ExplorationSemanticAnnotation[] {
  return SEMANTIC_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => ({
    kind: rule.kind,
    label: rule.label,
    confidence: rule.confidence,
    rationale: `Matched ${rule.kind} vocabulary in explored step.`,
    evidenceStepIds: [stepId]
  }));
}

function searchableStepText(step: ExplorationScreenModelDraft["steps"][number]): string {
  return [
    step.action,
    step.target?.selector,
    step.target?.testid,
    step.target?.role,
    step.target?.text,
    typeof step.data === "string" ? step.data : JSON.stringify(step.data ?? ""),
    step.domSnapshot,
    ...step.networkEvents.map((event) => `${event.method} ${event.url} ${event.status ?? ""}`)
  ]
    .filter(Boolean)
    .join("\n");
}

function businessMeaningFor(
  annotations: readonly ExplorationSemanticAnnotation[]
): string | undefined {
  const primary = [...annotations].sort((left, right) => right.confidence - left.confidence)[0];
  return primary ? `Likely ${primary.label}.` : undefined;
}

function triggerHintsFor(
  stepIds: readonly string[],
  steps: readonly { stepId: string; action: string; target?: { text?: string; role?: string } }[]
): readonly string[] {
  return stepIds.flatMap((stepId) => {
    const step = steps.find((candidate) => candidate.stepId === stepId);
    if (!step || !["click", "fill", "select", "navigate"].includes(step.action)) return [];
    return [`${step.action}${step.target?.text ? ` ${step.target.text}` : ""}`];
  });
}

function outcomeHintsFor(
  stepIds: readonly string[],
  steps: readonly { stepId: string; semanticAnnotations: readonly ExplorationSemanticAnnotation[] }[]
): readonly string[] {
  return stepIds.flatMap((stepId) => {
    const step = steps.find((candidate) => candidate.stepId === stepId);
    if (!step) return [];
    return step.semanticAnnotations
      .filter((annotation) => annotation.kind === "assertion")
      .map((annotation) => annotation.label);
  });
}

function uniqueAnnotations(
  annotations: readonly ExplorationSemanticAnnotation[]
): readonly ExplorationSemanticAnnotation[] {
  const byKey = new Map<string, ExplorationSemanticAnnotation>();
  for (const annotation of annotations) {
    const key = `${annotation.kind}:${annotation.label}`;
    const existing = byKey.get(key);
    if (!existing || annotation.confidence > existing.confidence) {
      byKey.set(key, {
        ...annotation,
        evidenceStepIds: uniqueStrings([
          ...(existing?.evidenceStepIds ?? []),
          ...annotation.evidenceStepIds
        ])
      });
      continue;
    }
    byKey.set(key, {
      ...existing,
      evidenceStepIds: uniqueStrings([
        ...existing.evidenceStepIds,
        ...annotation.evidenceStepIds
      ])
    });
  }
  return [...byKey.values()];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
