import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { type WSContext } from "hono/ws";
import {
  HealthResponseSchema,
  type HealthResponse,
  type WorkbenchEvent
} from "@pwqa/shared";
import { buildAgentEnv, type AgentEnv } from "./env.js";
import { createLogger } from "./logger.js";
import {
  createNodeCommandRunner,
  type CommandRunner
} from "./commands/runner.js";
import {
  DEFAULT_ALLOWED_EXECUTABLES,
  DEFAULT_ENV_ALLOWLIST,
  type CommandPolicy
} from "./commands/policy.js";
import { createEventBus, type EventBus } from "./events/bus.js";
import { createRunManager, type RunManager } from "./playwright/runManager.js";
import { createProjectStore, type ProjectStore } from "./project/store.js";
import { projectsRoutes } from "./routes/projects.js";
import { runsRoutes } from "./routes/runs.js";
import { scanProject } from "./project/scanner.js";

const SERVICE_VERSION = "0.1.0";

export interface BuildAppOptions {
  env: AgentEnv;
  policy?: CommandPolicy;
}

export interface BuildAppResult {
  app: Hono;
  injectWebSocket: (server: ServerType) => void;
  bus: EventBus;
  runner: CommandRunner;
  runManager: RunManager;
  projectStore: ProjectStore;
}

function defaultPolicy(env: AgentEnv): CommandPolicy {
  // PoC: cwd boundary defaults to the configured project root if known,
  // otherwise the current working directory. Routes that scan additional
  // projects construct fresh runners with project-scoped policies.
  const cwdBoundary = env.initialProjectRoot ?? process.cwd();
  return {
    allowedExecutables: DEFAULT_ALLOWED_EXECUTABLES,
    cwdBoundary,
    envAllowlist: DEFAULT_ENV_ALLOWLIST
  };
}

export function buildApp(options: BuildAppOptions): BuildAppResult {
  const { env } = options;
  const logger = createLogger(env.logLevel);
  const policy = options.policy ?? defaultPolicy(env);

  const bus = createEventBus();
  const runner = createNodeCommandRunner({
    policy,
    audit: (entry) => {
      logger.info({ audit: entry }, "command audit");
    }
  });
  const projectStore = createProjectStore();
  const runManager = createRunManager({ runner, bus });

  const app = new Hono();

  app.use("*", async (c, next) => {
    // Permissive CORS for local Workbench (loopback only).
    c.res.headers.set("Access-Control-Allow-Origin", "*");
    c.res.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
    c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  });

  app.get("/health", (c) => {
    const response: HealthResponse = HealthResponseSchema.parse({
      ok: true,
      service: "playwright-workbench-agent",
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString()
    });
    return c.json(response);
  });

  app.route("/", projectsRoutes({
    projectStore,
    runner,
    allowedRoots: env.allowedRoots
  }));
  app.route("/", runsRoutes({ projectStore, runManager }));

  // WebSocket channel
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  app.get(
    "/ws",
    upgradeWebSocket(() => {
      let unsubscribe: (() => void) | undefined;
      return {
        onOpen(_evt: Event, ws: WSContext) {
          unsubscribe = bus.subscribe((event) => {
            ws.send(JSON.stringify(event));
          });
          ws.send(
            JSON.stringify({
              type: "snapshot",
              sequence: 0,
              timestamp: new Date().toISOString(),
              payload: { service: "playwright-workbench-agent", version: SERVICE_VERSION }
            } satisfies WorkbenchEvent)
          );
        },
        onClose() {
          unsubscribe?.();
        },
        onError() {
          unsubscribe?.();
        }
      };
    })
  );

  // Bootstrap initial project root (CLI flag) if provided.
  if (env.initialProjectRoot) {
    void scanProject({
      rootPath: env.initialProjectRoot,
      allowedRoots: env.allowedRoots
    })
      .then((result) => {
        projectStore.set(result);
        logger.info(
          { projectId: result.summary.id, packageManager: result.packageManager.name },
          "Initial project loaded"
        );
      })
      .catch((error: unknown) => {
        logger.error(
          { err: error instanceof Error ? error.message : String(error) },
          "Failed to load initial project"
        );
      });
  }

  return { app, injectWebSocket, bus, runner, runManager, projectStore };
}

async function main(): Promise<void> {
  const env = buildAgentEnv({ argv: process.argv.slice(2) });
  const logger = createLogger(env.logLevel);
  const { app, injectWebSocket } = buildApp({ env });
  const server = serve(
    { fetch: app.fetch, port: env.port, hostname: env.host },
    (info) => {
      logger.info({ port: info.port, host: env.host }, "Local Agent listening");
    }
  );
  injectWebSocket(server);
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === new URL(`file://${process.argv[1]}`).href
  : false;
if (isDirectExecution) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
    );
    process.exit(1);
  });
}
