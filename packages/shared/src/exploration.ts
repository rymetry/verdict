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

export const ExploredStepSchema = z
  .object({
    stepId: z.string().min(1),
    action: ExplorationActionSchema,
    target: ExplorationTargetSchema.optional(),
    data: z.unknown().optional(),
    domSnapshot: z.string(),
    networkEvents: z.array(ExplorationNetworkEventSchema).default([])
  })
  .readonly();
export type ExploredStep = z.infer<typeof ExploredStepSchema>;

export const ObservedFlowSchema = z
  .object({
    flowId: z.string().min(1),
    title: z.string().min(1),
    stepIds: z.array(z.string().min(1))
  })
  .readonly();
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

export const ExplorationScreenModelDraftSchema = ExplorationAdapterOutputBaseSchema.extend({
  provider: ExplorationProviderIdSchema,
  generatedAt: z.string()
}).readonly();
export type ExplorationScreenModelDraft = z.infer<
  typeof ExplorationScreenModelDraftSchema
>;
