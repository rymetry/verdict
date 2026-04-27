import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_ALLOWED_EXECUTABLES,
  DEFAULT_ENV_ALLOWLIST,
  envAllowlistFilter,
  resolveExecutableName,
  type CommandPolicy
} from "./policy.js";

export interface CommandSpec {
  executable: string;
  args: ReadonlyArray<string>;
  cwd: string;
  /** Subset of env to forward, filtered by `policy.envAllowlist`. */
  env?: NodeJS.ProcessEnv;
  /** Hard timeout in ms. Defaults to 30 minutes. */
  timeoutMs?: number;
  /** Optional human-readable label for audit logs. */
  label?: string;
}

export interface CommandStreamHandlers {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  stdout: string;
  stderr: string;
  /** True when the command was cancelled before completion. */
  cancelled: boolean;
  /** True when the command was terminated for exceeding `timeoutMs`. */
  timedOut: boolean;
  command: { executable: string; args: ReadonlyArray<string>; cwd: string };
}

export interface CommandHandle {
  result: Promise<CommandResult>;
  cancel(reason?: string): void;
  pid?: number;
}

export interface CommandRunner {
  run(spec: CommandSpec, handlers?: CommandStreamHandlers): CommandHandle;
}

export class CommandPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandPolicyError";
  }
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function ensureWithinBoundary(cwdAbs: string, boundary: string): void {
  const relative = path.relative(boundary, cwdAbs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new CommandPolicyError(
      `cwd ${cwdAbs} escapes the project boundary ${boundary}.`
    );
  }
}

function realpathOrThrow(input: string): string {
  try {
    return fs.realpathSync(input);
  } catch (error) {
    throw new CommandPolicyError(
      `cwd ${input} is not accessible: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function checkPolicy(spec: CommandSpec, policy: CommandPolicy): void {
  const name = resolveExecutableName(spec.executable);
  if (!policy.allowedExecutables.includes(name)) {
    throw new CommandPolicyError(
      `Executable '${name}' is not in the allowed list (${policy.allowedExecutables.join(", ")}).`
    );
  }
  const allowlist = policy.argAllowlists?.[name];
  if (allowlist) {
    for (const arg of spec.args) {
      const matched = allowlist.some((re) => re.test(arg));
      if (!matched) {
        throw new CommandPolicyError(
          `Argument '${arg}' is not allowed for '${name}'.`
        );
      }
    }
  }
  const cwdAbs = realpathOrThrow(path.resolve(spec.cwd));
  ensureWithinBoundary(cwdAbs, policy.cwdBoundary);
}

export interface NodeCommandRunnerOptions {
  policy: CommandPolicy;
  /** Optional hook invoked once per spec for audit logging. */
  audit?: (entry: AuditEntry) => void;
}

export interface AuditEntry {
  startedAt: string;
  executable: string;
  args: ReadonlyArray<string>;
  cwd: string;
  label?: string;
}

export function createNodeCommandRunner({
  policy,
  audit
}: NodeCommandRunnerOptions): CommandRunner {
  return {
    run(spec: CommandSpec, handlers: CommandStreamHandlers = {}): CommandHandle {
      checkPolicy(spec, policy);

      const startedAt = new Date();
      audit?.({
        startedAt: startedAt.toISOString(),
        executable: spec.executable,
        args: [...spec.args],
        cwd: spec.cwd,
        label: spec.label
      });

      const sourceEnv: NodeJS.ProcessEnv = spec.env ?? process.env;
      const filteredEnv = envAllowlistFilter(
        sourceEnv,
        policy.envAllowlist.length > 0 ? policy.envAllowlist : DEFAULT_ENV_ALLOWLIST
      );

      const child: ChildProcess = spawn(spec.executable, [...spec.args], {
        cwd: spec.cwd,
        env: filteredEnv,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");

      child.stdout?.on("data", (chunk: string) => {
        stdoutChunks.push(chunk);
        handlers.onStdout?.(chunk);
      });
      child.stderr?.on("data", (chunk: string) => {
        stderrChunks.push(chunk);
        handlers.onStderr?.(chunk);
      });

      let cancelled = false;
      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | undefined;
      const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, timeoutMs);
      }

      const result = new Promise<CommandResult>((resolve, reject) => {
        child.on("error", (error: NodeJS.ErrnoException) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          // ENOENT / EACCES surface as runner errors rather than mystery exit codes.
          reject(
            new Error(
              `Failed to spawn '${spec.executable}': ${error.message}${error.code ? ` (${error.code})` : ""}`
            )
          );
        });
        child.on("close", (exitCode, signal) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          const endedAt = new Date();
          resolve({
            exitCode,
            signal: signal ?? null,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            durationMs: endedAt.getTime() - startedAt.getTime(),
            stdout: stdoutChunks.join(""),
            stderr: stderrChunks.join(""),
            cancelled,
            timedOut,
            command: { executable: spec.executable, args: [...spec.args], cwd: spec.cwd }
          });
        });
      });

      return {
        result,
        pid: child.pid,
        cancel(reason?: string) {
          if (cancelled) return;
          cancelled = true;
          if (handlers.onStderr && reason) {
            handlers.onStderr(`\n[workbench] cancelled: ${reason}\n`);
          }
          child.kill("SIGTERM");
        }
      };
    }
  };
}

export { DEFAULT_ALLOWED_EXECUTABLES, DEFAULT_ENV_ALLOWLIST };
