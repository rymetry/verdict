import { z } from "zod";

export const ExplorationProviderIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, {
    message: "Provider id must be lowercase kebab/dot/underscore case"
  });
export type ExplorationProviderId = z.infer<typeof ExplorationProviderIdSchema>;

export const ExplorationBuiltinProviderSchema = z.enum(["stagehand", "browser-use"]);
export type ExplorationBuiltinProvider = z.infer<typeof ExplorationBuiltinProviderSchema>;

export const ExplorationActionSchema = z.enum([
  "navigate",
  "click",
  "fill",
  "select",
  "wait",
  "observe"
]);
export type ExplorationAction = z.infer<typeof ExplorationActionSchema>;

export const ExplorationTargetSchema = z
  .object({
    selector: z.string().min(1).optional(),
    testid: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    text: z.string().min(1).optional()
  })
  .readonly();
export type ExplorationTarget = z.infer<typeof ExplorationTargetSchema>;

export const ExplorationNetworkEventSchema = z
  .object({
    method: z.string().min(1),
    url: z.string().min(1),
    status: z.number().int().optional()
  })
  .readonly();
export type ExplorationNetworkEvent = z.infer<typeof ExplorationNetworkEventSchema>;

const ExploredStepBaseSchema = z.object({
  stepId: z.string().min(1),
  action: ExplorationActionSchema,
  target: ExplorationTargetSchema.optional(),
  data: z.unknown().optional(),
  domSnapshot: z.string(),
  networkEvents: z.array(ExplorationNetworkEventSchema).default([])
});
export const ExploredStepSchema = ExploredStepBaseSchema.readonly();
export type ExploredStep = z.infer<typeof ExploredStepSchema>;

const ObservedFlowBaseSchema = z.object({
  flowId: z.string().min(1),
  title: z.string().min(1),
  stepIds: z.array(z.string().min(1))
});
export const ObservedFlowSchema = ObservedFlowBaseSchema.readonly();
export type ObservedFlow = z.infer<typeof ObservedFlowSchema>;

export const ClarificationRequestSchema = z
  .object({
    question: z.string().min(1),
    reason: z.string().min(1),
    blocking: z.boolean()
  })
  .readonly();
export type ClarificationRequest = z.infer<typeof ClarificationRequestSchema>;

const ExplorationAdapterOutputBaseSchema = z.object({
  startUrl: z.string().min(1),
  steps: z.array(ExploredStepSchema),
  observedFlows: z.array(ObservedFlowSchema),
  unclear: z.array(ClarificationRequestSchema),
  warnings: z.array(z.string())
});

export const ExplorationAdapterOutputSchema = ExplorationAdapterOutputBaseSchema.readonly();
export type ExplorationAdapterOutput = z.infer<typeof ExplorationAdapterOutputSchema>;

const ExplorationScreenModelDraftBaseSchema = ExplorationAdapterOutputBaseSchema.extend({
  provider: ExplorationProviderIdSchema,
  generatedAt: z.string()
});
export const ExplorationScreenModelDraftSchema =
  ExplorationScreenModelDraftBaseSchema.readonly();
export type ExplorationScreenModelDraft = z.infer<
  typeof ExplorationScreenModelDraftSchema
>;

export const ExplorationSemanticKindSchema = z.enum([
  "authentication",
  "navigation",
  "form",
  "field",
  "action",
  "assertion",
  "payment",
  "data",
  "unknown"
]);
export type ExplorationSemanticKind = z.infer<typeof ExplorationSemanticKindSchema>;

export const ExplorationSemanticAnnotationSchema = z
  .object({
    kind: ExplorationSemanticKindSchema,
    label: z.string().min(1),
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1).optional(),
    evidenceStepIds: z.array(z.string().min(1)).default([])
  })
  .readonly();
export type ExplorationSemanticAnnotation = z.infer<
  typeof ExplorationSemanticAnnotationSchema
>;

export const AnnotatedExploredStepSchema = ExploredStepBaseSchema.extend({
  semanticAnnotations: z.array(ExplorationSemanticAnnotationSchema).default([]),
  businessMeaning: z.string().min(1).optional()
}).readonly();
export type AnnotatedExploredStep = z.infer<typeof AnnotatedExploredStepSchema>;

export const AnnotatedObservedFlowSchema = ObservedFlowBaseSchema.extend({
  description: z.string().min(1).optional(),
  triggers: z.array(z.string().min(1)).default([]),
  outcomes: z.array(z.string().min(1)).default([]),
  semanticAnnotations: z.array(ExplorationSemanticAnnotationSchema).default([])
}).readonly();
export type AnnotatedObservedFlow = z.infer<typeof AnnotatedObservedFlowSchema>;

export const AnnotatedScreenModelSchema = ExplorationScreenModelDraftBaseSchema.extend({
  steps: z.array(AnnotatedExploredStepSchema),
  observedFlows: z.array(AnnotatedObservedFlowSchema),
  semantics: z.array(ExplorationSemanticAnnotationSchema).default([]),
  comprehension: z
    .object({
      generatedAt: z.string(),
      strategy: z.enum(["heuristic", "llm"]),
      warnings: z.array(z.string())
    })
    .readonly()
}).readonly();
export type AnnotatedScreenModel = z.infer<typeof AnnotatedScreenModelSchema>;

export const TestLayerSchema = z.enum([
  "unit",
  "integration",
  "contract",
  "e2e",
  "manual",
  "none-needed"
]);
export type TestLayer = z.infer<typeof TestLayerSchema>;

export const LayerJudgmentSchema = z
  .object({
    flowId: z.string().min(1),
    recommended: TestLayerSchema,
    confidence: z.number().min(0).max(1),
    rationale: z.string().min(1),
    alternativeLayers: z.array(TestLayerSchema).default([]),
    riskIfWrong: z.enum(["low", "medium", "high"]),
    evidenceStepIds: z.array(z.string().min(1)).default([])
  })
  .readonly();
export type LayerJudgment = z.infer<typeof LayerJudgmentSchema>;

export const LayerJudgmentResultSchema = z
  .object({
    generatedAt: z.string(),
    strategy: z.enum(["heuristic", "llm"]),
    judgments: z.array(LayerJudgmentSchema),
    warnings: z.array(z.string())
  })
  .readonly();
export type LayerJudgmentResult = z.infer<typeof LayerJudgmentResultSchema>;
