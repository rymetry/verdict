import { loadConfig, hasDeployConfig } from "./config.js";
import { classifyToolFailure } from "./failures.js";
import { SpawnCommandRunner, type CommandRunner } from "./githubShip.js";
import { evaluateDeployGate } from "./policy.js";
import { appendLearning, appendTimeline, ensureProgress, writeProgress } from "./state.js";
import type { AutonomyConfig, FailureClass, GateDecision } from "./types.js";

export interface RunDeployMonitorOptions {
  projectRoot: string;
  taskId?: string;
  approvalGranted?: boolean;
  runner?: CommandRunner;
  now?: Date;
}

export interface DeployStageSummary {
  stage: "land-and-deploy" | "canary";
  status: "pass" | "fail" | "skipped" | "blocked";
  summary: string;
  evidence: string[];
  failureClass?: FailureClass;
  deployUrl?: string;
}

export interface RunDeployMonitorResult {
  environment: "preview" | "staging" | "production";
  provider: string;
  gate: GateDecision;
  deploy: DeployStageSummary;
  canary: DeployStageSummary;
  summary: string;
}

interface DeployProviderPlan {
  provider: string;
  deployCommand?: string[];
  deployHealthCheckUrl?: string;
  canaryCommand?: string[];
  canaryHealthCheckUrl?: string;
  timeoutMs?: number;
  canaryTimeoutMs?: number;
}

export function runDeployMonitor(options: RunDeployMonitorOptions): RunDeployMonitorResult {
  const config = loadConfig(options.projectRoot);
  const runner = options.runner ?? new SpawnCommandRunner(options.projectRoot);
  const environment = config.deploy?.environment ?? "preview";
  const plan = resolveDeployProviderPlan(config);
  const emptyDeploy = makeStage("land-and-deploy", "skipped", "Deploy config is not configured.");
  const emptyCanary = makeStage("canary", "skipped", "Canary config is not configured.");

  if (!hasDeployConfig(config)) {
    appendTimeline(options.projectRoot, {
      stage: "land-and-deploy",
      status: "skipped",
      input: { taskId: options.taskId },
      output: { message: emptyDeploy.summary }
    });
    appendTimeline(options.projectRoot, {
      stage: "canary",
      status: "skipped",
      input: { taskId: options.taskId },
      output: { message: emptyCanary.summary }
    });
    return {
      environment,
      provider: plan.provider,
      gate: { allowed: true, reasons: [] },
      deploy: emptyDeploy,
      canary: emptyCanary,
      summary: "Deploy/Monitor skipped because no deploy config is present."
    };
  }

  const gate = evaluateDeployGate({
    environment,
    productionPolicy: config.deploy?.productionPolicy,
    approvalGranted: options.approvalGranted
  });
  if (!gate.allowed) {
    const blocked = makeStage(
      "land-and-deploy",
      "blocked",
      `Deploy gate blocked: ${gate.reasons.join("; ")}`
    );
    updateDeployProgress(options, environment, "pending");
    appendTimeline(options.projectRoot, {
      stage: "land-and-deploy",
      status: "pending",
      input: { taskId: options.taskId, environment },
      output: { message: blocked.summary, gate },
      evidence: [".agents/autonomy.config.json"]
    });
    return {
      environment,
      provider: plan.provider,
      gate,
      deploy: blocked,
      canary: emptyCanary,
      summary: blocked.summary
    };
  }

  if (plan.provider === "unsupported") {
    const failure = makeStage(
      "land-and-deploy",
      "fail",
      `Deploy provider is not supported: ${config.deploy?.provider ?? config.adapters.deployProvider ?? "unknown"}.`,
      [".agents/autonomy.config.json"],
      "UNCLASSIFIED"
    );
    appendTimeline(options.projectRoot, {
      stage: "land-and-deploy",
      status: "fail",
      input: { taskId: options.taskId, provider: config.deploy?.provider ?? config.adapters.deployProvider },
      output: { message: failure.summary },
      evidence: failure.evidence,
      failureClass: failure.failureClass
    });
    updateDeployProgress(options, environment, "failed");
    recordDeployFailure(options.projectRoot, options.taskId, "UNCLASSIFIED", failure.summary);
    return {
      environment,
      provider: plan.provider,
      gate,
      deploy: failure,
      canary: emptyCanary,
      summary: failure.summary
    };
  }

  const deploy = runDeployStage({ projectRoot: options.projectRoot, config, plan, runner, taskId: options.taskId });
  if (deploy.status === "fail") {
    updateDeployProgress(options, environment, "failed");
    recordDeployFailure(options.projectRoot, options.taskId, deploy.failureClass ?? "UNCLASSIFIED", deploy.summary);
    return {
      environment,
      provider: plan.provider,
      gate,
      deploy,
      canary: emptyCanary,
      summary: deploy.summary
    };
  }

  updateDeployProgress(options, environment, "deployed");
  const canary = runCanaryStage({
    projectRoot: options.projectRoot,
    config,
    plan,
    runner,
    taskId: options.taskId,
    deployUrl: deploy.deployUrl
  });
  if (canary.status === "fail") {
    updateDeployProgress(options, environment, "failed");
    recordDeployFailure(options.projectRoot, options.taskId, canary.failureClass ?? "CANARY_FAILURE", canary.summary);
    return {
      environment,
      provider: plan.provider,
      gate,
      deploy,
      canary,
      summary: canary.summary
    };
  }

  appendLearning(options.projectRoot, {
    key: `deploy-monitor-${environment}`,
    type: "tool",
    insight: `Deploy/Monitor completed for ${environment} with deploy=${deploy.status} and canary=${canary.status}.`,
    source: "deploy"
  });
  return {
    environment,
    provider: plan.provider,
    gate,
    deploy,
    canary,
    summary: `Deploy/Monitor completed for ${environment}.`
  };
}

function runDeployStage(input: {
  projectRoot: string;
  config: AutonomyConfig;
  plan: DeployProviderPlan;
  runner: CommandRunner;
  taskId?: string;
}): DeployStageSummary {
  const command = input.plan.deployCommand;
  const healthCheckUrl = input.plan.deployHealthCheckUrl;
  const evidence: string[] = [];
  let deployUrl: string | undefined;

  if (command?.length) {
    const result = runConfiguredCommand({
      runner: input.runner,
      command,
      provider: input.plan.provider,
      stage: "land-and-deploy",
      taskId: input.taskId,
      environment: input.config.deploy?.environment ?? "preview",
      healthCheckUrl,
      timeoutMs: input.plan.timeoutMs
    });
    evidence.push(...result.evidence);
    deployUrl = result.deployUrl;
    if (result.status === "fail") {
      appendTimeline(input.projectRoot, {
        stage: "land-and-deploy",
        status: "fail",
        input: { taskId: input.taskId },
        output: { message: result.summary },
        evidence,
        failureClass: result.failureClass
      });
      return result;
    }
  }

  if (healthCheckUrl) {
    const result = runHealthCheck({
      runner: input.runner,
      stage: "land-and-deploy",
      url: expandPlaceholders(healthCheckUrl, {
        taskId: input.taskId,
        environment: input.config.deploy?.environment ?? "preview",
        stage: "land-and-deploy",
        healthCheckUrl,
        deployUrl
      }),
      timeoutMs: input.plan.timeoutMs
    });
    evidence.push(...result.evidence);
    if (result.status === "fail") {
      appendTimeline(input.projectRoot, {
        stage: "land-and-deploy",
        status: "fail",
        input: { taskId: input.taskId, healthCheckUrl },
        output: { message: result.summary },
        evidence,
        failureClass: result.failureClass
      });
      return result;
    }
  }

  const status = command?.length || healthCheckUrl ? "pass" : "skipped";
  const summary =
    status === "pass"
      ? "Deploy stage completed."
      : "Deploy stage skipped because no deploy command or health check is configured.";
  appendTimeline(input.projectRoot, {
    stage: "land-and-deploy",
    status,
    input: { taskId: input.taskId },
    output: { message: summary },
    evidence
  });
  return makeStage("land-and-deploy", status, summary, evidence, undefined, deployUrl);
}

function runCanaryStage(input: {
  projectRoot: string;
  config: AutonomyConfig;
  plan: DeployProviderPlan;
  runner: CommandRunner;
  taskId?: string;
  deployUrl?: string;
}): DeployStageSummary {
  if (input.config.deploy?.canary?.enabled === false) {
    const skipped = makeStage("canary", "skipped", "Canary stage disabled by config.");
    appendTimeline(input.projectRoot, {
      stage: "canary",
      status: "skipped",
      input: { taskId: input.taskId },
      output: { message: skipped.summary }
    });
    return skipped;
  }

  const command = input.plan.canaryCommand;
  const healthCheckUrl = input.plan.canaryHealthCheckUrl;
  const evidence: string[] = [];
  const hasCanaryCommand = Boolean(command?.length);
  const requiresDeployUrl = Boolean(healthCheckUrl?.includes("{deployUrl}") && !input.deployUrl);
  if (requiresDeployUrl && !hasCanaryCommand) {
    const failure = makeStage(
      "canary",
      "fail",
      "Canary health check requires a deploy URL, but no deploy URL was inferred from deploy stdout.",
      [],
      "CANARY_FAILURE"
    );
    appendTimeline(input.projectRoot, {
      stage: "canary",
      status: "fail",
      input: { taskId: input.taskId, healthCheckUrl },
      output: { message: failure.summary },
      failureClass: failure.failureClass
    });
    return failure;
  }

  if (command?.length) {
    const result = runConfiguredCommand({
      runner: input.runner,
      command,
      provider: input.plan.provider,
      stage: "canary",
      taskId: input.taskId,
      environment: input.config.deploy?.environment ?? "preview",
      healthCheckUrl,
      deployUrl: input.deployUrl,
      timeoutMs: input.plan.canaryTimeoutMs ?? input.plan.timeoutMs,
      canaryFailure: true
    });
    evidence.push(...result.evidence);
    if (result.status === "fail") {
      appendTimeline(input.projectRoot, {
        stage: "canary",
        status: "fail",
        input: { taskId: input.taskId },
        output: { message: result.summary },
        evidence,
        failureClass: result.failureClass
      });
      return result;
    }
  }

  const hasRunnableHealthCheck = Boolean(healthCheckUrl && !requiresDeployUrl);
  if (hasRunnableHealthCheck && healthCheckUrl) {
    const result = runHealthCheck({
      runner: input.runner,
      stage: "canary",
      url: expandPlaceholders(healthCheckUrl, {
        taskId: input.taskId,
        environment: input.config.deploy?.environment ?? "preview",
        stage: "canary",
        healthCheckUrl,
        deployUrl: input.deployUrl
      }),
      timeoutMs: input.plan.canaryTimeoutMs ?? input.plan.timeoutMs,
      canaryFailure: true
    });
    evidence.push(...result.evidence);
    if (result.status === "fail") {
      appendTimeline(input.projectRoot, {
        stage: "canary",
        status: "fail",
        input: { taskId: input.taskId, healthCheckUrl },
        output: { message: result.summary },
        evidence,
        failureClass: result.failureClass
      });
      return result;
    }
  }

  const status = hasCanaryCommand || hasRunnableHealthCheck ? "pass" : "skipped";
  const summary =
    status === "pass"
      ? "Canary stage completed."
      : "Canary stage skipped because no canary command or health check is configured.";
  appendTimeline(input.projectRoot, {
    stage: "canary",
    status,
    input: { taskId: input.taskId },
    output: { message: summary },
    evidence
  });
  return makeStage("canary", status, summary, evidence);
}

function runConfiguredCommand(input: {
  runner: CommandRunner;
  command: readonly string[];
  provider: string;
  stage: "land-and-deploy" | "canary";
  taskId?: string;
  environment: string;
  healthCheckUrl?: string;
  deployUrl?: string;
  timeoutMs?: number;
  canaryFailure?: boolean;
}): DeployStageSummary {
  const [command, ...args] = input.command.map((value) =>
    expandPlaceholders(value, {
      taskId: input.taskId,
      environment: input.environment,
      stage: input.stage,
      healthCheckUrl: input.healthCheckUrl,
      deployUrl: input.deployUrl
    })
  );
  if (!command) {
    return makeStage(input.stage, "skipped", `${input.stage} command is empty.`);
  }
  const result = input.runner.run(command, args, { timeoutMs: input.timeoutMs });
  const evidence = [`command:${command}`];
  const deployUrl = inferDeployUrl(result.stdout, input.provider);
  if (result.exitCode === 0) {
    return makeStage(
      input.stage,
      "pass",
      trimOrDefault(result.stdout, `${input.stage} command completed.`),
      deployUrl ? [...evidence, deployUrl] : evidence,
      undefined,
      deployUrl
    );
  }
  const failureClass = input.canaryFailure ? "CANARY_FAILURE" : classifyToolFailure(result.stderr || result.stdout);
  return makeStage(
    input.stage,
    "fail",
    trimOrDefault(result.stderr || result.stdout, `${input.stage} command failed.`),
    evidence,
    failureClass
  );
}

function runHealthCheck(input: {
  runner: CommandRunner;
  stage: "land-and-deploy" | "canary";
  url: string;
  timeoutMs?: number;
  canaryFailure?: boolean;
}): DeployStageSummary {
  const result = input.runner.run("curl", ["-fsS", input.url], { timeoutMs: input.timeoutMs });
  const evidence = [input.url];
  if (result.exitCode === 0) {
    return makeStage(input.stage, "pass", "Health check passed.", evidence);
  }
  const failureClass = input.canaryFailure ? "CANARY_FAILURE" : classifyToolFailure(result.stderr || result.stdout);
  return makeStage(
    input.stage,
    "fail",
    trimOrDefault(result.stderr || result.stdout, `Health check failed for ${input.url}.`),
    evidence,
    failureClass
  );
}

function updateDeployProgress(
  options: RunDeployMonitorOptions,
  environment: string,
  status: "pending" | "deployed" | "failed" | "skipped"
): void {
  const progress = ensureProgress(options.projectRoot, options.now);
  progress.last_iter_at = (options.now ?? new Date()).toISOString();
  progress.stats.deploys += status === "deployed" ? 1 : 0;
  if (progress.active) {
    progress.active.deploy = { environment, status };
  }
  writeProgress(options.projectRoot, progress);
}

function recordDeployFailure(
  projectRoot: string,
  taskId: string | undefined,
  failureClass: FailureClass,
  reason: string
): void {
  const progress = ensureProgress(projectRoot);
  progress.escalated.push({
    id: taskId ? `${taskId}:deploy` : "deploy",
    at: new Date().toISOString(),
    class: failureClass,
    reason
  });
  writeProgress(projectRoot, progress);
}

function makeStage(
  stage: "land-and-deploy" | "canary",
  status: DeployStageSummary["status"],
  summary: string,
  evidence: string[] = [],
  failureClass?: FailureClass,
  deployUrl?: string
): DeployStageSummary {
  return { stage, status, summary, evidence, failureClass, deployUrl };
}

function trimOrDefault(text: string, fallback: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function resolveDeployProviderPlan(config: AutonomyConfig): DeployProviderPlan {
  const provider = config.deploy?.provider ?? config.adapters.deployProvider ?? "custom-command";
  if (provider === "custom-command") {
    return {
      provider,
      deployCommand: config.deploy?.customCommand,
      deployHealthCheckUrl: config.deploy?.healthCheckUrl,
      canaryCommand: config.deploy?.canary?.customCommand,
      canaryHealthCheckUrl: config.deploy?.canary?.healthCheckUrl ?? config.deploy?.healthCheckUrl,
      timeoutMs: config.deploy?.timeoutMs,
      canaryTimeoutMs: config.deploy?.canary?.timeoutMs
    };
  }
  if (provider === "vercel-compatible") {
    const environment = config.deploy?.environment ?? "preview";
    return {
      provider,
      deployCommand: config.deploy?.customCommand ?? [
        "pnpm",
        "exec",
        "vercel",
        "deploy",
        "--yes",
        ...(environment === "production" ? ["--prod"] : [])
      ],
      deployHealthCheckUrl: config.deploy?.healthCheckUrl,
      canaryCommand: config.deploy?.canary?.customCommand,
      canaryHealthCheckUrl:
        config.deploy?.canary?.healthCheckUrl ?? config.deploy?.healthCheckUrl ?? "{deployUrl}",
      timeoutMs: config.deploy?.timeoutMs,
      canaryTimeoutMs: config.deploy?.canary?.timeoutMs
    };
  }
  if (config.deploy?.customCommand?.length) {
    return {
      provider,
      deployCommand: config.deploy.customCommand,
      deployHealthCheckUrl: config.deploy.healthCheckUrl,
      canaryCommand: config.deploy.canary?.customCommand,
      canaryHealthCheckUrl: config.deploy.canary?.healthCheckUrl ?? config.deploy.healthCheckUrl,
      timeoutMs: config.deploy.timeoutMs,
      canaryTimeoutMs: config.deploy.canary?.timeoutMs
    };
  }
  return { provider: "unsupported" };
}

function expandPlaceholders(
  value: string,
  input: {
    taskId?: string;
    environment: string;
    stage: "land-and-deploy" | "canary";
    healthCheckUrl?: string;
    deployUrl?: string;
  }
): string {
  return value
    .replaceAll("{taskId}", input.taskId ?? "")
    .replaceAll("{environment}", input.environment)
    .replaceAll("{stage}", input.stage)
    .replaceAll("{healthCheckUrl}", input.healthCheckUrl ?? "")
    .replaceAll("{deployUrl}", input.deployUrl ?? "");
}

function inferDeployUrl(stdout: string, provider: string): string | undefined {
  const urls = [...stripAnsi(stdout).matchAll(/https?:\/\/[^\s"'<>]+/g)].map((match) =>
    match[0].replace(/[),.;:]+$/, "")
  );
  const vercelAppUrl = urls.find((url) => {
    try {
      const hostname = new URL(url).hostname;
      return hostname === "vercel.app" || hostname.endsWith(".vercel.app");
    } catch {
      return false;
    }
  });
  if (vercelAppUrl) {
    return vercelAppUrl;
  }
  if (provider === "vercel-compatible") {
    return undefined;
  }
  return urls[0];
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}
