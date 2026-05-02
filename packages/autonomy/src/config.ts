import * as fs from "node:fs";
import * as path from "node:path";
import type { AutonomyConfig, StageName } from "./types.js";

export const DEFAULT_WORKFLOW: StageName[] = [
  "think",
  "plan",
  "build",
  "qa-only",
  "review",
  "ship",
  "learn"
];

export const DESIGN_REVIEW_STAGES: StageName[] = ["plan-design-review", "design-review"];
export const DEPLOY_STAGES: StageName[] = ["land-and-deploy", "canary"];

export function configPath(projectRoot: string): string {
  return path.join(projectRoot, ".agents", "autonomy.config.json");
}

export function defaultConfig(): AutonomyConfig {
  return {
    version: 1,
    workflow: {
      preset: "default",
      stages: DEFAULT_WORKFLOW
    },
    adapters: {
      taskSource: "markdown-roadmap",
      executor: "codex",
      verifier: "manual-verification",
      reviewer: "codex-review",
      publisher: "github-pr"
    },
    taskSources: {
      markdownRoadmap: {
        paths: ["ROADMAP.md", "docs/ROADMAP.md", "docs/roadmap.md", "TODO.md"]
      }
    },
    safety: {
      autoMerge: false,
      highRiskPatterns: [
        "auth",
        "permission",
        "billing",
        "payment",
        "delete",
        "external integration",
        "deploy"
      ],
      maxFailuresPerTask: 3
    }
  };
}

export function loadConfig(projectRoot: string): AutonomyConfig {
  const target = configPath(projectRoot);
  if (!fs.existsSync(target)) {
    return defaultConfig();
  }
  const parsed = JSON.parse(fs.readFileSync(target, "utf8")) as Partial<AutonomyConfig>;
  return mergeConfig(defaultConfig(), parsed);
}

export function mergeConfig(base: AutonomyConfig, override: Partial<AutonomyConfig>): AutonomyConfig {
  return {
    ...base,
    ...override,
    workflow: { ...base.workflow, ...override.workflow },
    adapters: { ...base.adapters, ...override.adapters },
    taskSources: mergeTaskSources(base.taskSources, override.taskSources),
    deploy: override.deploy === undefined ? base.deploy : { ...base.deploy, ...override.deploy },
    safety: { ...base.safety, ...override.safety }
  };
}

function mergeTaskSources(
  base: AutonomyConfig["taskSources"],
  override: AutonomyConfig["taskSources"]
): AutonomyConfig["taskSources"] {
  return {
    ...base,
    ...override,
    markdownRoadmap: {
      ...base?.markdownRoadmap,
      ...override?.markdownRoadmap
    },
    customCommand: {
      ...base?.customCommand,
      ...override?.customCommand
    }
  };
}

export function hasDeployConfig(config: AutonomyConfig): boolean {
  return Boolean(
    config.deploy?.enabled ||
      config.deploy?.provider ||
      config.deploy?.customCommand?.length ||
      config.deploy?.healthCheckUrl ||
      config.adapters.deployProvider
  );
}

export function resolveWorkflow(config: AutonomyConfig): StageName[] {
  const seed = config.workflow?.stages?.length ? config.workflow.stages : DEFAULT_WORKFLOW;
  const stages = seed.filter((stage) => !DEPLOY_STAGES.includes(stage));

  if (config.workflow?.includeDesignReview) {
    insertAfter(stages, "plan", "plan-design-review");
    insertAfter(stages, "qa-only", "design-review");
  }

  if (hasDeployConfig(config)) {
    insertAfter(stages, "ship", "land-and-deploy");
    if (config.deploy?.canary?.enabled !== false) {
      insertAfter(stages, "land-and-deploy", "canary");
    }
  }

  if (!stages.includes("learn")) {
    stages.push("learn");
  }
  if (stages.at(-1) !== "learn") {
    const withoutLearn: StageName[] = stages.filter((stage) => stage !== "learn");
    withoutLearn.push("learn");
    return withoutLearn;
  }
  return stages;
}

function insertAfter(stages: StageName[], after: StageName, stage: StageName): void {
  if (stages.includes(stage)) {
    return;
  }
  const index = stages.indexOf(after);
  if (index === -1) {
    stages.push(stage);
    return;
  }
  stages.splice(index + 1, 0, stage);
}
