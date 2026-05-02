import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  ExplorationScreenModelDraftSchema,
  type ExplorationProviderId,
  type WorkbenchConfig
} from "@pwqa/shared";
import { runPathsFor, workbenchPaths } from "../storage/paths.js";
import type {
  ExplorationAdapter,
  ExplorationAttempt,
  ExplorationInput,
  ExplorationResult,
  ScreenModelDraft
} from "./types.js";
import { sanitizeExplorationScreenModel } from "./redact.js";

const DEFAULT_CONFIG: WorkbenchConfig = {
  version: "0.1",
  exploration: {
    defaultProvider: "stagehand",
    fallbackProviders: ["browser-use"],
    maxAttempts: 2,
    providers: []
  }
};

export class ExplorationEngineError extends Error {
  constructor(
    message: string,
    readonly code:
      | "EXPLORATION_ADAPTER_UNAVAILABLE"
      | "EXPLORATION_FAILED"
      | "EXPLORATION_INVALID_RUN_ID",
    readonly attempts: readonly ExplorationAttempt[] = []
  ) {
    super(message);
    this.name = "ExplorationEngineError";
  }
}

export interface ExplorationEngineOptions {
  adapters: ReadonlyArray<ExplorationAdapter>;
  now?: () => Date;
}

export interface ExplorationEngine {
  explore(input: ExplorationInput): Promise<ExplorationResult>;
}

export function createExplorationEngine(options: ExplorationEngineOptions): ExplorationEngine {
  const adapterMap = new Map(options.adapters.map((adapter) => [adapter.name, adapter]));
  const now = options.now ?? (() => new Date());

  return {
    async explore(input) {
      validateRunId(input.runId);
      const config = normalizeConfig(input.config);
      const attempts: ExplorationAttempt[] = [];
      const providers = providerOrder(config);

      for (const provider of providers) {
        const adapter = adapterMap.get(provider);
        if (!adapter || !providerEnabled(config, provider)) {
          attempts.push({
            provider,
            attempt: 0,
            status: "unavailable",
            code: "adapter-unavailable"
          });
          continue;
        }

        const maxAttempts = Math.max(1, config.exploration.maxAttempts);
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          let draft: Awaited<ReturnType<ExplorationAdapter["explore"]>>;
          try {
            draft = await adapter.explore({
              projectRoot: input.projectRoot,
              startUrl: input.startUrl,
              intent: input.intent,
              provider
            });
          } catch {
            attempts.push({
              provider,
              attempt,
              status: "failed",
              code: "adapter-failed"
            });
            continue;
          }

          const screenModel: ScreenModelDraft = sanitizeExplorationScreenModel(
            ExplorationScreenModelDraftSchema.parse({
              ...draft,
              startUrl: input.startUrl,
              provider,
              generatedAt: now().toISOString()
            }),
            input.projectRoot
          );
          const artifactRelativePath = await persistExploration({
            projectRoot: input.projectRoot,
            runId: input.runId,
            screenModel
          });
          return {
            screenModel,
            artifactRelativePath,
            attempts
          };
        }
      }

      const anyFailed = attempts.some((attempt) => attempt.status === "failed");
      throw new ExplorationEngineError(
        anyFailed
          ? "Exploration failed for every configured provider."
          : "No configured exploration adapter is available.",
        anyFailed ? "EXPLORATION_FAILED" : "EXPLORATION_ADAPTER_UNAVAILABLE",
        attempts
      );
    }
  };
}

function normalizeConfig(config: WorkbenchConfig | undefined): WorkbenchConfig {
  if (!config) return DEFAULT_CONFIG;
  return {
    ...DEFAULT_CONFIG,
    ...config,
    exploration: {
      ...DEFAULT_CONFIG.exploration,
      ...config.exploration
    }
  };
}

function providerOrder(config: WorkbenchConfig): readonly ExplorationProviderId[] {
  const ordered = [
    config.exploration.defaultProvider,
    ...config.exploration.fallbackProviders
  ];
  return [...new Set(ordered)];
}

function providerEnabled(
  config: WorkbenchConfig,
  provider: ExplorationProviderId
): boolean {
  return config.exploration.providers.find((entry) => entry.name === provider)?.enabled ?? true;
}

async function persistExploration(input: {
  projectRoot: string;
  runId: string;
  screenModel: ScreenModelDraft;
}): Promise<string> {
  const absoluteProjectRoot = await fs.realpath(input.projectRoot);
  const paths = runPathsFor(absoluteProjectRoot, input.runId);
  const runDir = paths.runDir;
  await ensureSafeDirectory(workbenchPaths(absoluteProjectRoot).workbenchDir);
  await ensureSafeDirectory(workbenchPaths(absoluteProjectRoot).runsDir);
  await ensureSafeDirectory(runDir);
  const artifactPath = path.join(runDir, "exploration.json");
  await writeNoFollow(artifactPath, `${JSON.stringify(input.screenModel, null, 2)}\n`);
  return projectRelativePath(artifactPath, absoluteProjectRoot);
}

function validateRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId) || runId.includes("..")) {
    throw new ExplorationEngineError(
      "Exploration runId must be a single safe path segment.",
      "EXPLORATION_INVALID_RUN_ID"
    );
  }
}

function projectRelativePath(absolutePath: string, projectRoot: string): string {
  const relative = path.relative(projectRoot, absolutePath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Exploration artifact escaped the project root.");
  }
  const workbenchDir = workbenchPaths(projectRoot).workbenchDir;
  if (!absolutePath.startsWith(`${workbenchDir}${path.sep}`)) {
    throw new Error("Exploration artifact escaped the workbench directory.");
  }
  return relative.split(path.sep).join("/");
}

async function ensureSafeDirectory(directory: string): Promise<void> {
  const existing = await fs.lstat(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw new Error("Exploration artifact directory is not a safe directory.");
    }
    return;
  }

  await fs.mkdir(directory, { recursive: false, mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") return;
    throw error;
  });
  const created = await fs.lstat(directory);
  if (created.isSymbolicLink() || !created.isDirectory()) {
    throw new Error("Exploration artifact directory is not a safe directory.");
  }
}

async function writeNoFollow(filePath: string, content: string): Promise<void> {
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const handle = await fs.open(
    filePath,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | noFollow,
    0o600
  );
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
}
