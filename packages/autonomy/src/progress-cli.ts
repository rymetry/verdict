#!/usr/bin/env node
import * as path from "node:path";
import { loadConfig } from "./config.js";
import { seedCompletedTasks } from "./state.js";
import { knownTaskIds } from "./taskSources.js";

const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
const command = args[0];

try {
  if (command !== "seed-completed") {
    throw new Error("Usage: agent-autonomy-progress seed-completed --ids <task-id[,task-id...]>");
  }

  const projectRoot = readPathArg(args, "--cwd", process.env.INIT_CWD ?? process.cwd());
  const taskIds = readTaskIds(args);
  const result = seedCompletedTasks({
    projectRoot,
    taskIds,
    knownTaskIds: knownTaskIds(projectRoot, loadConfig(projectRoot)),
    allowUnknown: args.includes("--allow-unknown")
  });
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

function readTaskIds(args: string[]): string[] {
  const values: string[] = [];
  for (const flag of ["--ids", "--completed"]) {
    let index = args.indexOf(flag);
    while (index !== -1) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${flag} requires a comma-separated task id list`);
      }
      values.push(...value.split(","));
      index = args.indexOf(flag, index + 2);
    }
  }
  return values;
}
