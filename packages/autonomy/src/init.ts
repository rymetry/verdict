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
    const target = path.join(options.targetRoot, relative);
    if (!fs.existsSync(source)) {
      skipped.push(relative);
      continue;
    }
    if (fs.existsSync(target) && !options.force) {
      skipped.push(relative);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    if (relative.includes("/hooks/")) {
      fs.chmodSync(target, 0o755);
    }
    written.push(relative);
  }
  return { written, skipped };
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
