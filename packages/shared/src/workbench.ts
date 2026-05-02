import { z } from "zod";

const ProjectRelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(value), {
    message: "Path must be project-relative"
  })
  .refine((value) => !value.split(/[\\/]/).includes(".."), {
    message: "Path must not contain traversal segments"
  });

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

export const WorkbenchContextSchema = z
  .object({
    agents: WorkbenchAgentsManifestSchema.optional(),
    skills: z.array(WorkbenchSkillSchema).readonly(),
    rules: z.array(WorkbenchRuleSchema).readonly(),
    hooks: z.array(WorkbenchHookSpecSchema).readonly(),
    intents: z.array(WorkbenchIntentSchema).readonly(),
    prompts: z.array(WorkbenchPromptSchema).readonly()
  })
  .readonly();
export type WorkbenchContext = z.infer<typeof WorkbenchContextSchema>;
