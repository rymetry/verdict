#!/usr/bin/env node
import * as path from "node:path";
import { drive } from "./driver.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

try {
  const projectRoot = readPathArg(args, "--cwd", process.env.INIT_CWD ?? process.cwd());
  const result = drive({ projectRoot, dryRun });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}

function readPathArg(args: string[], flag: string, fallback: string): string {
  const base = process.env.INIT_CWD ?? process.cwd();
  const index = args.indexOf(flag);
  if (index === -1) {
    return path.resolve(fallback);
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a path value`);
  }
  return path.resolve(base, value);
}
