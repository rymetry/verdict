import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeCommandRunner } from "../src/commands/runner.js";
import { createGitPatchCommandPolicy } from "../src/commands/policy.js";
import {
  createPatchManager,
  extractPatchFiles,
  PatchValidationError
} from "../src/git/patchManager.js";

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function createRepo(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pwqa-patch-")));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  git(root, ["init"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  git(root, ["config", "user.name", "Patch Test"]);
  fs.writeFileSync(path.join(root, "src", "example.txt"), "alpha\nbeta\n");
  git(root, ["add", "src/example.txt"]);
  git(root, ["commit", "-m", "initial"]);
  return root;
}

function managerFor(root: string) {
  return createPatchManager(
    createNodeCommandRunner({ policy: createGitPatchCommandPolicy(root) })
  );
}

function replacementPatch(root: string, next = "gamma"): string {
  fs.writeFileSync(path.join(root, "src", "example.txt"), `alpha\n${next}\n`);
  const patch = git(root, ["diff", "--", "src/example.txt"]);
  git(root, ["checkout", "--", "src/example.txt"]);
  return patch;
}

describe("PatchManager (T600-1)", () => {
  it("extracts and validates project-relative patch paths", () => {
    const patch = [
      "diff --git a/src/example.txt b/src/example.txt",
      "--- a/src/example.txt",
      "+++ b/src/example.txt"
    ].join("\n");

    expect(extractPatchFiles(patch)).toEqual(["src/example.txt"]);
    expect(() => extractPatchFiles("not a git diff")).toThrow(PatchValidationError);
    expect(() =>
      extractPatchFiles("diff --git a/../outside.txt b/../outside.txt")
    ).toThrow(PatchValidationError);
    expect(() =>
      extractPatchFiles("diff --git a//absolute.txt b//absolute.txt")
    ).toThrow(PatchValidationError);
  });

  it("checks a clean patch without modifying the working tree", async () => {
    const root = createRepo();
    try {
      const patch = replacementPatch(root);
      const result = await managerFor(root).check({ projectRoot: root, patch });

      expect(result).toEqual(
        expect.objectContaining({
          ok: true,
          filesTouched: ["src/example.txt"],
          dirtyFiles: [],
          diagnostics: "ok"
        })
      );
      expect(fs.readFileSync(path.join(root, "src", "example.txt"), "utf8")).toBe("alpha\nbeta\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks patches that target dirty files", async () => {
    const root = createRepo();
    try {
      const patch = replacementPatch(root);
      fs.writeFileSync(path.join(root, "src", "example.txt"), "alpha\nlocal edit\n");

      const result = await managerFor(root).check({ projectRoot: root, patch });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("dirty-worktree");
      expect(result.dirtyFiles).toEqual(["src/example.txt"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns apply-check diagnostics for invalid hunks", async () => {
    const root = createRepo();
    try {
      const patch = [
        "diff --git a/src/example.txt b/src/example.txt",
        "--- a/src/example.txt",
        "+++ b/src/example.txt",
        "@@ -1,2 +1,2 @@",
        " nope",
        "-missing",
        "+replacement",
        ""
      ].join("\n");

      const result = await managerFor(root).check({ projectRoot: root, patch });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("apply-check-failed");
      expect(result.diagnostics).not.toBe("ok");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("temporarily applies and reverts a valid patch", async () => {
    const root = createRepo();
    try {
      const patch = replacementPatch(root);
      const manager = managerFor(root);

      const applied = await manager.applyTemporary({ projectRoot: root, patch });
      expect(applied.applied).toBe(true);
      expect(fs.readFileSync(path.join(root, "src", "example.txt"), "utf8")).toBe("alpha\ngamma\n");

      const reverted = await manager.revertTemporary({ projectRoot: root, patch });
      expect(reverted.reverted).toBe(true);
      expect(fs.readFileSync(path.join(root, "src", "example.txt"), "utf8")).toBe("alpha\nbeta\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not apply when the preflight check fails", async () => {
    const root = createRepo();
    try {
      const patch = replacementPatch(root);
      fs.writeFileSync(path.join(root, "src", "example.txt"), "alpha\nlocal edit\n");

      const result = await managerFor(root).applyTemporary({ projectRoot: root, patch });

      expect(result.applied).toBe(false);
      expect(fs.readFileSync(path.join(root, "src", "example.txt"), "utf8")).toBe("alpha\nlocal edit\n");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
