import * as path from "node:path";
import * as fs from "node:fs";

export interface AgentEnv {
  port: number;
  host: string;
  logLevel: string;
  /** Optional default project root resolved from CLI/env. */
  initialProjectRoot?: string;
  /** Allowed runtime root directories (realpath). Used to gate `POST /projects/open`. */
  allowedRoots: ReadonlyArray<string>;
}

interface BuildEnvInput {
  argv?: ReadonlyArray<string>;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_PORT = 4317;
const DEFAULT_HOST = "127.0.0.1";

function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_PORT;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0 || value > 65535) {
    throw new Error(`Invalid PORT value: ${raw}`);
  }
  return value;
}

function realpathSafe(input: string): string | undefined {
  try {
    return fs.realpathSync(input);
  } catch {
    return undefined;
  }
}

export function buildAgentEnv({ argv = [], env = process.env }: BuildEnvInput = {}): AgentEnv {
  const projectArgIndex = argv.findIndex((arg) => arg === "--project" || arg === "-p");
  const projectArg = projectArgIndex >= 0 ? argv[projectArgIndex + 1] : undefined;
  const portArgIndex = argv.findIndex((arg) => arg === "--port");
  const portArg = portArgIndex >= 0 ? argv[portArgIndex + 1] : undefined;

  const port = parsePort(portArg ?? env.PORT);
  const host = env.HOST ?? DEFAULT_HOST;
  const logLevel = env.LOG_LEVEL ?? "info";

  const projectInput = projectArg ?? env.WORKBENCH_PROJECT_ROOT;
  const initialProjectRoot = projectInput
    ? realpathSafe(path.resolve(projectInput))
    : undefined;

  const additionalRoots = (env.WORKBENCH_ALLOWED_ROOTS ?? "")
    .split(":")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => realpathSafe(path.resolve(entry)))
    .filter((value): value is string => Boolean(value));

  const allowedRoots = Array.from(
    new Set(
      [initialProjectRoot, ...additionalRoots].filter((value): value is string => Boolean(value))
    )
  );

  return {
    port,
    host,
    logLevel,
    initialProjectRoot,
    allowedRoots
  };
}
