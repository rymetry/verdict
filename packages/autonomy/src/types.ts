export type StageName =
  | "think"
  | "plan"
  | "plan-design-review"
  | "build"
  | "qa-only"
  | "design-review"
  | "review"
  | "ship"
  | "land-and-deploy"
  | "canary"
  | "learn";

export type StageStatus = "pending" | "running" | "pass" | "fail" | "skipped" | "dry-run";

export type FailureClass =
  | "RECURRING_CI_FAILURE"
  | "RECURRING_TYPE_ERROR"
  | "RECURRING_SCOPE_VIOLATION"
  | "TOOL_AUTH_FAILURE"
  | "TOOL_NETWORK_FAILURE"
  | "CANARY_FAILURE"
  | "CODEX_HANG"
  | "UNCLASSIFIED";

export interface AutonomyConfig {
  version: 1;
  workflow?: {
    preset?: string;
    stages?: StageName[];
    includeDesignReview?: boolean;
  };
  adapters: {
    taskSource: string;
    executor: "codex" | "claude" | string;
    verifier: string;
    reviewer: string;
    publisher: string;
    deployProvider?: string;
  };
  taskSources?: {
    markdownRoadmap?: {
      paths?: string[];
    };
    customCommand?: {
      command?: string[];
      timeoutMs?: number;
    };
  };
  deploy?: {
    enabled?: boolean;
    environment?: "preview" | "staging" | "production";
    provider?: "custom-command" | "vercel-compatible" | string;
    customCommand?: string[];
    healthCheckUrl?: string;
    productionPolicy?: "approval" | "auto";
    canary?: {
      enabled?: boolean;
      checks?: string[];
    };
  };
  safety?: {
    autoMerge?: boolean;
    highRiskPatterns?: string[];
    maxFailuresPerTask?: number;
  };
}

export interface ProgressState {
  schema_version: 1;
  started_at: string;
  last_iter_at: string | null;
  active: {
    id: string;
    title?: string;
    pr_number: number | null;
    branch: string | null;
    stage: StageName | null;
    started_at: string;
    last_attempt_at: string;
    deploy?: {
      environment: string;
      status: "pending" | "deployed" | "failed" | "skipped";
    };
  } | null;
  completed: string[];
  failure_counts: Record<string, number>;
  escalated: Array<{
    id: string;
    at: string;
    class: FailureClass;
    reason: string;
  }>;
  stats: {
    iterations: number;
    executor_calls: number;
    ci_polls: number;
    deploys: number;
  };
}

export interface TimelineEntry {
  at: string;
  stage: StageName;
  status: StageStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  evidence?: string[];
  failureClass?: FailureClass;
}

export interface LearningEntry {
  at: string;
  key: string;
  type: "pattern" | "pitfall" | "tool" | "environment" | "decision";
  insight: string;
  source: "driver" | "review" | "qa" | "deploy" | "user";
}

export interface MergeGateInput {
  ci: "pass" | "fail" | "pending";
  qa: "pass" | "fail" | "skipped";
  review: "pass" | "p0-p1" | "fail";
  scope: "pass" | "fail";
  workingTree: "clean" | "dirty";
}

export interface GateDecision {
  allowed: boolean;
  reasons: string[];
}

export interface TaskBrief {
  id: string;
  title: string;
  deliverable: string;
  expectedScope: string[];
  highRisk?: boolean;
}

export interface TaskSelection {
  task: TaskBrief | null;
  warnings: string[];
  evidence: string[];
  blockedReason?: string;
}

export interface AdapterContext {
  projectRoot: string;
  config: AutonomyConfig;
}

export interface StageResult {
  status: "pass" | "fail" | "waiting" | "escalated";
  evidence: string[];
  summary: string;
  failureClass?: FailureClass;
}

export interface TaskSource {
  name: string;
  pickNext(context: AdapterContext): Promise<TaskBrief | null>;
}

export interface Executor {
  name: string;
  execute(context: AdapterContext, task: TaskBrief): Promise<StageResult>;
}

export interface Verifier {
  name: string;
  verify(context: AdapterContext, task: TaskBrief): Promise<StageResult>;
}

export interface Reviewer {
  name: string;
  review(context: AdapterContext, task: TaskBrief): Promise<StageResult>;
}

export interface Publisher {
  name: string;
  publish(context: AdapterContext, task: TaskBrief): Promise<StageResult>;
}

export interface DeployProvider {
  name: string;
  deploy(context: AdapterContext, task: TaskBrief): Promise<StageResult>;
  canary?(context: AdapterContext, task: TaskBrief): Promise<StageResult>;
}
