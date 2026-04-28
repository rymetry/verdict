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
  /** When true, command execution fails if audit persistence fails. */
  failClosedAudit: boolean;
}

interface BuildEnvInput {
  argv?: ReadonlyArray<string>;
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_PORT = 4317;
const DEFAULT_HOST = "127.0.0.1";

const SAFE_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function parsePort(raw: string | undefined): number {
  if (!raw) return DEFAULT_PORT;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0 || value > 65535) {
    throw new Error(`Invalid PORT value: ${raw}`);
  }
  return value;
}

function parseHost(raw: string | undefined, allowAnyHost: boolean): string {
  const value = raw ?? DEFAULT_HOST;
  if (allowAnyHost) return value;
  if (!SAFE_HOSTS.has(value)) {
    throw new Error(
      `Refusing to bind to non-loopback host '${value}'. Set WORKBENCH_ALLOW_REMOTE=1 or true to override.`
    );
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

function parseBooleanFlag(name: string, raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === "") return false;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  // Remote bind や audit fail-close の誤設定を避けるため、曖昧な truthy/falsy は拒否する。
  throw new Error(`Invalid ${name} value: ${raw}. Use 1, true, 0, or false.`);
}

export function buildAgentEnv({ argv = [], env = process.env }: BuildEnvInput = {}): AgentEnv {
  const projectArgIndex = argv.findIndex((arg) => arg === "--project" || arg === "-p");
  const projectArg = projectArgIndex >= 0 ? argv[projectArgIndex + 1] : undefined;
  const portArgIndex = argv.findIndex((arg) => arg === "--port");
  const portArg = portArgIndex >= 0 ? argv[portArgIndex + 1] : undefined;

  const port = parsePort(portArg ?? env.PORT);
  const allowAnyHost = parseBooleanFlag("WORKBENCH_ALLOW_REMOTE", env.WORKBENCH_ALLOW_REMOTE);
  const host = parseHost(env.HOST, allowAnyHost);
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
    allowedRoots,
    failClosedAudit: parseBooleanFlag("AGENT_FAIL_CLOSED_AUDIT", env.AGENT_FAIL_CLOSED_AUDIT)
  };
}
