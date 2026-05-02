import type {
  ExplorationAdapterOutput,
  ExplorationProviderId,
  ExplorationScreenModelDraft,
  WorkbenchConfig,
} from "@pwqa/shared";

export type ScreenModelDraft = ExplorationScreenModelDraft;

export interface ExplorationIntentInput {
  name?: string;
  content?: string;
  acceptanceExamples?: readonly string[];
}

export interface ExplorationInput {
  projectRoot: string;
  runId: string;
  startUrl: string;
  intent?: ExplorationIntentInput;
  config?: WorkbenchConfig;
}

export interface ExplorationAdapterInput {
  projectRoot: string;
  startUrl: string;
  intent?: ExplorationIntentInput;
  provider: ExplorationProviderId;
}

export interface ExplorationAdapter {
  name: ExplorationProviderId;
  explore(input: ExplorationAdapterInput): Promise<ExplorationAdapterOutput>;
}

export interface ExplorationAttempt {
  provider: ExplorationProviderId;
  attempt: number;
  status: "failed" | "unavailable";
  code: string;
}

export interface ExplorationResult {
  screenModel: ScreenModelDraft;
  artifactRelativePath: string;
  attempts: readonly ExplorationAttempt[];
}
