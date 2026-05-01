import * as path from "node:path";
import type {
  PatchApplyResponse,
  PatchCheckResponse,
  PatchRevertResponse
} from "@pwqa/shared";
import type { CommandRunner } from "../commands/runner.js";

export class PatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchValidationError";
  }
}

export interface PatchManager {
  check(input: PatchOperationInput): Promise<PatchCheckResponse>;
  applyTemporary(input: PatchOperationInput): Promise<PatchApplyResponse>;
  revertTemporary(input: PatchOperationInput): Promise<PatchRevertResponse>;
}

export interface PatchOperationInput {
  projectRoot: string;
  patch: string;
}

export function createPatchManager(runner: CommandRunner): PatchManager {
  return {
    check: (input) => checkPatch(input, runner),
    applyTemporary: (input) => applyTemporaryPatch(input, runner),
    revertTemporary: (input) => revertTemporaryPatch(input, runner)
  };
}

export function extractPatchFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    if (!line.startsWith("diff --git ")) continue;
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (!match) {
      throw new PatchValidationError("Patch contains a diff header that is not in git format.");
    }
    for (const raw of [match[1]!, match[2]!]) {
      if (raw === "/dev/null") continue;
      files.add(validatePatchPath(raw));
    }
  }
  if (files.size === 0) {
    throw new PatchValidationError("Patch must contain at least one git diff header.");
  }
  return [...files].sort();
}

async function checkPatch(
  input: PatchOperationInput,
  runner: CommandRunner
): Promise<PatchCheckResponse> {
  const filesTouched = extractPatchFiles(input.patch);
  const dirtyFiles = await listDirtyFiles(input.projectRoot, filesTouched, runner);
  if (dirtyFiles.length > 0) {
    return {
      ok: false,
      filesTouched,
      dirtyFiles,
      diagnostics: "Patch target files have uncommitted changes.",
      reason: "dirty-worktree"
    };
  }
  const result = await runGit(input.projectRoot, ["apply", "--check", "-"], runner, input.patch);
  return {
    ok: result.exitCode === 0,
    filesTouched,
    dirtyFiles: [],
    diagnostics: summarizeGitOutput(result.stdout, result.stderr),
    reason: result.exitCode === 0 ? undefined : "apply-check-failed"
  };
}

async function applyTemporaryPatch(
  input: PatchOperationInput,
  runner: CommandRunner
): Promise<PatchApplyResponse> {
  const checked = await checkPatch(input, runner);
  if (!checked.ok) {
    return {
      applied: false,
      filesTouched: checked.filesTouched,
      diagnostics: checked.diagnostics
    };
  }
  const result = await runGit(input.projectRoot, ["apply", "-"], runner, input.patch);
  return {
    applied: result.exitCode === 0,
    filesTouched: checked.filesTouched,
    diagnostics: summarizeGitOutput(result.stdout, result.stderr)
  };
}

async function revertTemporaryPatch(
  input: PatchOperationInput,
  runner: CommandRunner
): Promise<PatchRevertResponse> {
  const filesTouched = extractPatchFiles(input.patch);
  const result = await runGit(input.projectRoot, ["apply", "--reverse", "-"], runner, input.patch);
  return {
    reverted: result.exitCode === 0,
    filesTouched,
    diagnostics: summarizeGitOutput(result.stdout, result.stderr)
  };
}

async function listDirtyFiles(
  projectRoot: string,
  files: string[],
  runner: CommandRunner
): Promise<string[]> {
  const result = await runGit(projectRoot, ["status", "--porcelain", "--", ...files], runner);
  if (result.exitCode !== 0) {
    throw new PatchValidationError(summarizeGitOutput(result.stdout, result.stderr));
  }
  const dirty = new Set<string>();
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const file = line.slice(3).split(" -> ").pop()?.trim();
    if (file) dirty.add(file);
  }
  return [...dirty].sort();
}

async function runGit(
  projectRoot: string,
  args: string[],
  runner: CommandRunner,
  stdin?: string
) {
  return runner.run({
    executable: "git",
    args,
    cwd: projectRoot,
    timeoutMs: 60_000,
    label: `git:${args.slice(0, 2).join(":")}`,
    stdin
  }).result;
}

function validatePatchPath(raw: string): string {
  if (raw.includes("\0")) {
    throw new PatchValidationError("Patch paths must not contain NUL bytes.");
  }
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\")) {
    throw new PatchValidationError("Patch paths must be project-relative.");
  }
  const parts = raw.split(/[\\/]+/);
  if (parts.includes("..") || parts.length === 0 || parts.some((part) => part.length === 0)) {
    throw new PatchValidationError("Patch paths must stay inside the project root.");
  }
  return raw;
}

function summarizeGitOutput(stdout: string, stderr: string): string {
  const text = [stdout, stderr].filter(Boolean).join("\n").trim();
  return text.length > 0 ? text.slice(-4_096) : "ok";
}
