#!/usr/bin/env node
import * as path from "node:path";
import { drive } from "./driver.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const cwdIndex = args.indexOf("--cwd");
const defaultRoot = process.env.INIT_CWD ?? process.cwd();
const projectRoot = cwdIndex === -1 ? defaultRoot : path.resolve(args[cwdIndex + 1] ?? ".");

try {
  const result = drive({ projectRoot, dryRun });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
