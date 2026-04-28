import * as fsSync from "node:fs";
import * as path from "node:path";
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
  type AuditEntry,
  type CommandRunner
} from "./commands/runner.js";
import { AuditPersistenceError } from "./commands/audit.js";
import {
  createDefaultCommandPolicy,
  type CommandPolicy
} from "./commands/policy.js";
import { createEventBus, type EventBus } from "./events/bus.js";
import { createRunManager, type RunManager } from "./playwright/runManager.js";
import { createProjectStore, type ProjectStore } from "./project/store.js";
import { projectsRoutes } from "./routes/projects.js";
import { runsRoutes } from "./routes/runs.js";
import { scanProject } from "./project/scanner.js";
import { workbenchPaths } from "./storage/paths.js";

const SERVICE_VERSION = "0.1.0";

const ALLOWED_ORIGINS = new Set<string>([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:4317",
  "http://localhost:4317"
]);

export interface BuildAppOptions {
  env: AgentEnv;
  policyFactory?: (projectRoot: string) => CommandPolicy;
  /** Optional override for the audit sink (used by tests). */
  audit?: (entry: AuditEntry) => void;
}

export interface BuildAppResult {
  app: Hono;
  injectWebSocket: (server: ServerType) => void;
  bus: EventBus;
  runnerForProject: (projectRoot: string) => CommandRunner;
  runManager: RunManager;
  projectStore: ProjectStore;
}

function persistAuditEntry(rootDir: string, entry: AuditEntry): void {
  const wb = workbenchPaths(rootDir);
  if (fsSync.existsSync(wb.workbenchDir)) {
    const stat = fsSync.lstatSync(wb.workbenchDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`audit directory is not a safe directory: ${wb.workbenchDir}`);
    }
  }
  fsSync.mkdirSync(wb.workbenchDir, { recursive: true });
  const stat = fsSync.lstatSync(wb.workbenchDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`audit directory is not a safe directory: ${wb.workbenchDir}`);
  }

  const auditPath = path.join(wb.workbenchDir, "audit.log");
  const noFollow = fsSync.constants.O_NOFOLLOW ?? 0;
  const fd = fsSync.openSync(
    auditPath,
    fsSync.constants.O_CREAT | fsSync.constants.O_APPEND | fsSync.constants.O_WRONLY | noFollow,
    0o600
  );
  try {
    fsSync.writeSync(fd, `${JSON.stringify(entry)}\n`, undefined, "utf8");
  } finally {
    fsSync.closeSync(fd);
  }
}

function attachCors(app: Hono): void {
  app.use("*", async (c, next) => {
    const origin = c.req.header("Origin");
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      c.res.headers.set("Access-Control-Allow-Origin", origin);
      c.res.headers.set("Vary", "Origin");
    }
    c.res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    c.res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  });
}

function attachHealth(app: Hono): void {
  app.get("/health", (c) => {
    const response: HealthResponse = HealthResponseSchema.parse({
      ok: true,
      service: "playwright-workbench-agent",
      version: SERVICE_VERSION,
      timestamp: new Date().toISOString()
    });
    return c.json(response);
  });
}

function attachWebSocket(
  app: Hono,
  bus: EventBus,
  logger: ReturnType<typeof createLogger>
): (server: ServerType) => void {
  // PLAN.v2 §7 / §33: factory pattern leaves the door open for a raw `ws`
  // fallback if @hono/node-ws becomes unstable.
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  app.get(
    "/ws",
    upgradeWebSocket(() => {
      let unsubscribe: (() => void) | undefined;
      return {
        onOpen(_evt: Event, ws: WSContext) {
          unsubscribe = bus.subscribe((event) => {
            const ready = (ws as unknown as { readyState?: number }).readyState;
            if (ready !== undefined && ready !== 1 /* OPEN */) return;
            try {
              ws.send(JSON.stringify(event));
            } catch (error) {
              logger.debug({ err: error }, "ws send failed");
            }
          });
          try {
            ws.send(
              JSON.stringify({
                type: "snapshot",
                sequence: 0,
                timestamp: new Date().toISOString(),
                payload: {
                  service: "playwright-workbench-agent",
                  version: SERVICE_VERSION
                }
              } satisfies WorkbenchEvent)
            );
          } catch {
            // socket already closed before snapshot could be delivered
          }
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
  return injectWebSocket;
}

export function buildApp(options: BuildAppOptions): BuildAppResult {
  const { env } = options;
  const logger = createLogger(env.logLevel);

  const bus = createEventBus({
    onListenerError: (error) => logger.debug({ err: error }, "ws listener error")
  });

  const runnerForProject = (projectRoot: string): CommandRunner => {
    const policy = options.policyFactory?.(projectRoot) ?? createDefaultCommandPolicy(projectRoot);
    return createNodeCommandRunner({
      policy,
      audit: (entry) => {
        logger.info({ audit: entry }, "command audit");
        let auditPersistenceError: AuditPersistenceError | undefined;
        try {
          persistAuditEntry(projectRoot, entry);
        } catch (error) {
          auditPersistenceError = new AuditPersistenceError(error);
          logger.error(
            {
              err: error instanceof Error ? error.message : String(error),
              code:
                error instanceof Error && "code" in error
                  ? String((error as NodeJS.ErrnoException).code)
                  : undefined,
              projectRoot
            },
            "failed to persist audit log entry"
          );
        }
        options.audit?.(entry);
        if (auditPersistenceError && env.failClosedAudit) {
          throw auditPersistenceError;
        }
      }
    });
  };

  const projectStore = createProjectStore();
  const runManager = createRunManager({ runnerForProject, bus, logger });

  const app = new Hono();
  attachCors(app);
  attachHealth(app);
  app.route(
    "/",
    projectsRoutes({ projectStore, runnerForProject, allowedRoots: env.allowedRoots })
  );
  app.route("/", runsRoutes({ projectStore, runManager, logger }));
  const injectWebSocket = attachWebSocket(app, bus, logger);

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

  return { app, injectWebSocket, bus, runnerForProject, runManager, projectStore };
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
