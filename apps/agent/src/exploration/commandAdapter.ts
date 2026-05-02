import {
  ExplorationAdapterOutputSchema,
  type ExplorationAdapterOutput,
  type ExplorationProviderId,
  type WorkbenchConfig,
  type WorkbenchExplorationCommand
} from "@pwqa/shared";
import type { CommandRunner } from "../commands/runner.js";
import type { ExplorationAdapter, ExplorationAdapterInput } from "./types.js";

const EXPLORATION_TIMEOUT_MS = 2 * 60 * 1000;

export interface CommandExplorationAdapterOptions {
  name: ExplorationProviderId;
  command: WorkbenchExplorationCommand;
  runner: CommandRunner;
}

export interface ConfiguredCommandExplorationAdaptersOptions {
  config: WorkbenchConfig;
  runner: CommandRunner;
}

export class ExplorationAdapterError extends Error {
  constructor(
    message: string,
    readonly code:
      | "EXPLORATION_COMMAND_FAILED"
      | "EXPLORATION_COMMAND_CANCELLED"
      | "EXPLORATION_COMMAND_TIMED_OUT"
      | "EXPLORATION_COMMAND_OUTPUT_INVALID"
  ) {
    super(message);
    this.name = "ExplorationAdapterError";
  }
}

export function createCommandExplorationAdapter(
  options: CommandExplorationAdapterOptions
): ExplorationAdapter {
  return {
    name: options.name,
    async explore(input) {
      const result = await options.runner.run({
        executable: options.command.executable,
        args: options.command.args,
        cwd: input.projectRoot,
        timeoutMs: options.command.timeoutMs ?? EXPLORATION_TIMEOUT_MS,
        label: `exploration:${options.name}`,
        stdin: JSON.stringify(commandInput(input), null, 2)
      }).result;

      if (result.timedOut) {
        throw new ExplorationAdapterError(
          "Exploration adapter command timed out.",
          "EXPLORATION_COMMAND_TIMED_OUT"
        );
      }
      if (result.cancelled) {
        throw new ExplorationAdapterError(
          "Exploration adapter command was cancelled.",
          "EXPLORATION_COMMAND_CANCELLED"
        );
      }
      if (result.exitCode !== 0) {
        throw new ExplorationAdapterError(
          "Exploration adapter command exited with a non-zero status.",
          "EXPLORATION_COMMAND_FAILED"
        );
      }
      return parseOutput(result.stdout);
    }
  };
}

export function createConfiguredCommandExplorationAdapters(
  options: ConfiguredCommandExplorationAdaptersOptions
): readonly ExplorationAdapter[] {
  return options.config.exploration.providers.flatMap((provider) => {
    if (!provider.enabled || !provider.command) return [];
    return [
      createCommandExplorationAdapter({
        name: provider.name,
        command: provider.command,
        runner: options.runner
      })
    ];
  });
}

function commandInput(input: ExplorationAdapterInput): Omit<ExplorationAdapterInput, "projectRoot"> {
  return {
    provider: input.provider,
    startUrl: input.startUrl,
    intent: input.intent
  };
}

function parseOutput(stdout: string): ExplorationAdapterOutput {
  try {
    const parsed = ExplorationAdapterOutputSchema.parse(JSON.parse(stdout));
    return parsed;
  } catch {
    throw new ExplorationAdapterError(
      "Exploration adapter did not return a valid screen model JSON object.",
      "EXPLORATION_COMMAND_OUTPUT_INVALID"
    );
  }
}
