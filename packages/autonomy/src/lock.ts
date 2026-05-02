import * as fs from "node:fs";
import * as path from "node:path";
import { stateDir } from "./state.js";

export interface LockHandle {
  path: string;
  token: string;
  release(): void;
}

export function lockPath(projectRoot: string): string {
  return path.join(stateDir(projectRoot), "lock");
}

export function acquireLock(projectRoot: string, staleMs = 30 * 60 * 1000): LockHandle {
  fs.mkdirSync(stateDir(projectRoot), { recursive: true });
  const target = lockPath(projectRoot);
  clearStaleLock(target, staleMs);
  const token = `${process.pid}:${Date.now()}`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(target, "wx", 0o600);
    fs.writeFileSync(fd, `${token}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Autonomy loop is already locked at ${target}: ${message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return {
    path: target,
    token,
    release() {
      if (!fs.existsSync(target)) return;
      const current = fs.readFileSync(target, "utf8").trim();
      if (current === token) {
        fs.rmSync(target, { force: true });
      }
    }
  };
}

function clearStaleLock(target: string, staleMs: number): void {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (Date.now() - stat.mtimeMs > staleMs) {
    fs.rmSync(target, { force: true });
  }
}
