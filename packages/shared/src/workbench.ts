import { z } from "zod";
import { ExplorationProviderIdSchema, type ExplorationProviderId } from "./exploration.js";

const ProjectRelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value), {
    message: "Path must be project-relative"
  })
  .refine((value) => !value.split(/[\\/]/).includes(".."), {
    message: "Path must not contain traversal segments"
  });

const SecretLikeArgPattern =
  /(sk-(?:proj|svcacct)-[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|xox[bpoart]-[A-Za-z0-9-]{20,}|(?:api[_-]?key|token|password|secret|credential)\s*[=:])/i;

const WorkbenchCommandArgSchema = z
  .string()
  .max(4_096)
  .refine((value) => !value.includes("\0"), {
    message: "Command args must not contain NUL bytes"
  })
  .refine((value) => commandArgSegments(value).every((segment) => !isAbsolutePathLike(segment)), {
    message: "Command args must not contain absolute paths"
  })
  .refine((value) => commandArgSegments(value).every((segment) => !hasTraversal(segment)), {
    message: "Command args must not contain traversal segments"
  })
  .refine((value) => !SecretLikeArgPattern.test(value), {
    message: "Command args must not contain inline secrets"
  });

function commandArgSegments(value: string): string[] {
  return value.split(/[=,:]/).filter((segment) => segment.length > 0);
}

function isAbsolutePathLike(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value);
}

function hasTraversal(value: string): boolean {
  return value.split(/[\\/]/).includes("..") || /(^|[=,])\.\.([\\/]|$)/.test(value);
}

export const WorkbenchFrontmatterSchema = z.record(z.string(), z.unknown());
export type WorkbenchFrontmatter = z.infer<typeof WorkbenchFrontmatterSchema>;

export const WorkbenchAgentsManifestSchema = z
  .object({
    relativePath: ProjectRelativePathSchema,
    content: z.string()
  })
  .readonly();
export type WorkbenchAgentsManifest = z.infer<typeof WorkbenchAgentsManifestSchema>;

const WorkbenchMarkdownDocumentSchema = z
  .object({
    name: z.string().min(1),
    relativePath: ProjectRelativePathSchema,
    frontmatter: WorkbenchFrontmatterSchema,
    content: z.string()
  })
  .readonly();

export const WorkbenchSkillSchema = WorkbenchMarkdownDocumentSchema;
export type WorkbenchSkill = z.infer<typeof WorkbenchSkillSchema>;

export const WorkbenchRuleSchema = WorkbenchMarkdownDocumentSchema;
export type WorkbenchRule = z.infer<typeof WorkbenchRuleSchema>;

export const WorkbenchPromptSchema = WorkbenchMarkdownDocumentSchema;
export type WorkbenchPrompt = z.infer<typeof WorkbenchPromptSchema>;

export const WorkbenchHookExtensionSchema = z.enum(["sh", "toml", "json"]);
export type WorkbenchHookExtension = z.infer<typeof WorkbenchHookExtensionSchema>;

export const WorkbenchHookSpecSchema = z
  .object({
    name: z.string().min(1),
    relativePath: ProjectRelativePathSchema,
    extension: WorkbenchHookExtensionSchema,
    content: z.string()
  })
  .readonly();
export type WorkbenchHookSpec = z.infer<typeof WorkbenchHookSpecSchema>;

export const WorkbenchIntentSchema = z
  .object({
    name: z.string().min(1),
    relativePath: ProjectRelativePathSchema,
    data: z.record(z.string(), z.unknown()),
    content: z.string()
  })
  .readonly();
export type WorkbenchIntent = z.infer<typeof WorkbenchIntentSchema>;

export const WorkbenchExplorationProviderSchema = ExplorationProviderIdSchema;
export type WorkbenchExplorationProvider = ExplorationProviderId;

const WorkbenchExplorationCommandSchema = z
  .object({
    executable: z
      .string()
      .min(1)
      .refine((value) => !value.includes("/") && !value.includes("\\"), {
        message: "Executable must be a command name, not a path"
      })
      .refine((value) => !/^[A-Za-z]:/.test(value), {
        message: "Executable must not be an absolute Windows path"
      }),
    args: z.array(WorkbenchCommandArgSchema).default([]),
    timeoutMs: z.number().int().positive().max(10 * 60 * 1000).optional()
  })
  .readonly();
export type WorkbenchExplorationCommand = z.infer<
  typeof WorkbenchExplorationCommandSchema
>;

const WorkbenchExplorationProviderConfigSchema = z
  .object({
    name: WorkbenchExplorationProviderSchema,
    enabled: z.boolean().default(true),
    command: WorkbenchExplorationCommandSchema.optional()
  })
  .readonly();
export type WorkbenchExplorationProviderConfig = z.infer<
  typeof WorkbenchExplorationProviderConfigSchema
>;

export const WorkbenchConfigSchema = z
  .object({
    version: z.literal("0.1"),
    exploration: z
      .object({
        defaultProvider: WorkbenchExplorationProviderSchema.default("stagehand"),
        fallbackProviders: z
          .array(WorkbenchExplorationProviderSchema)
          .default(["browser-use"]),
        maxAttempts: z.number().int().positive().max(5).default(2),
        providers: z
          .array(WorkbenchExplorationProviderConfigSchema)
          .default([])
          .refine(
            (providers) => new Set(providers.map((provider) => provider.name)).size === providers.length,
            { message: "Exploration provider names must be unique" }
          )
      })
      .default({
        defaultProvider: "stagehand",
        fallbackProviders: ["browser-use"],
        maxAttempts: 2,
        providers: []
      })
  })
  .readonly();
export type WorkbenchConfig = z.infer<typeof WorkbenchConfigSchema>;

export const WorkbenchContextSchema = z
  .object({
    config: WorkbenchConfigSchema.optional(),
    agents: WorkbenchAgentsManifestSchema.optional(),
    skills: z.array(WorkbenchSkillSchema).readonly(),
    rules: z.array(WorkbenchRuleSchema).readonly(),
    hooks: z.array(WorkbenchHookSpecSchema).readonly(),
    intents: z.array(WorkbenchIntentSchema).readonly(),
    prompts: z.array(WorkbenchPromptSchema).readonly()
  })
  .readonly();
export type WorkbenchContext = z.infer<typeof WorkbenchContextSchema>;
