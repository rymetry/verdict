import * as fs from "node:fs";
import * as path from "node:path";

export interface InitOptions {
  sourceRoot: string;
  targetRoot: string;
  force?: boolean;
}

export interface InitResult {
  written: string[];
  skipped: string[];
}

export function initProject(options: InitOptions): InitResult {
  const templateRoot = resolveTemplateRoot(options.sourceRoot);
  const written: string[] = [];
  const skipped: string[] = [];
  for (const relative of listTemplateFiles(templateRoot)) {
    const source = path.join(templateRoot, relative);
    const targetRelative = templateTargetPath(relative);
    const target = path.join(options.targetRoot, targetRelative);
    if (!fs.existsSync(source)) {
      skipped.push(targetRelative);
      continue;
    }
    if (fs.existsSync(target) && !options.force) {
      if (targetRelative === ".gitignore" && appendGitignoreStateRule(target)) {
        written.push(targetRelative);
        continue;
      }
      skipped.push(targetRelative);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    if (targetRelative.includes("/hooks/")) {
      fs.chmodSync(target, 0o755);
    }
    written.push(targetRelative);
  }
  return { written, skipped };
}

function templateTargetPath(relative: string): string {
  return relative === "gitignore" ? ".gitignore" : relative;
}

function appendGitignoreStateRule(target: string): boolean {
  const existing = fs.readFileSync(target, "utf8");
  if (/^\.agents\/state\/$/m.test(existing)) {
    return false;
  }
  const prefix = existing.endsWith("\n") ? "" : "\n";
  fs.appendFileSync(
    target,
    `${prefix}\n# Agent runtime state\n.agents/state/\n`,
    { mode: 0o600 }
  );
  return true;
}

function resolveTemplateRoot(sourceRoot: string): string {
  const repoTemplateRoot = path.join(sourceRoot, ".agents", "templates");
  if (fs.existsSync(repoTemplateRoot)) {
    return repoTemplateRoot;
  }
  return path.join(sourceRoot, "templates");
}

function listTemplateFiles(templateRoot: string): string[] {
  if (!fs.existsSync(templateRoot)) {
    return [];
  }
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (entry.isFile()) {
        files.push(path.relative(templateRoot, absolute));
      }
    }
  };
  visit(templateRoot);
  return files.sort();
}
