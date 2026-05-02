import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initProject } from "../src/init.js";

let sourceRoot: string;
let targetRoot: string;

beforeEach(() => {
  sourceRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-init-src-")));
  targetRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-init-dst-")));
  fs.mkdirSync(path.join(sourceRoot, ".agents/templates/.codex/hooks"), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, ".agents/templates/.claude"), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, ".agents/templates/.agents"), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, ".agents/templates/.agents/skills/drive-autonomy"), {
    recursive: true
  });
  fs.writeFileSync(path.join(sourceRoot, ".agents/templates/AGENTS.md"), "# Agent\n");
  fs.writeFileSync(path.join(sourceRoot, ".agents/templates/.gitignore"), ".agents/state/\n");
  fs.writeFileSync(path.join(sourceRoot, ".agents/templates/.agents/autonomy.config.json"), "{}\n");
  fs.writeFileSync(path.join(sourceRoot, ".agents/templates/.codex/config.toml"), "\n");
  fs.writeFileSync(
    path.join(sourceRoot, ".agents/templates/.codex/hooks/pre-tool-use-policy.sh"),
    "#!/usr/bin/env bash\n"
  );
  fs.writeFileSync(
    path.join(sourceRoot, ".agents/templates/.codex/hooks/post-tool-use-typecheck.sh"),
    "#!/usr/bin/env bash\n"
  );
  fs.writeFileSync(
    path.join(sourceRoot, ".agents/templates/.codex/hooks/stop-verify.sh"),
    "#!/usr/bin/env bash\n"
  );
  fs.writeFileSync(path.join(sourceRoot, ".agents/templates/.claude/settings.json"), "{}\n");
  fs.writeFileSync(
    path.join(sourceRoot, ".agents/templates/.agents/skills/drive-autonomy/SKILL.md"),
    "---\nname: drive-autonomy\n---\n"
  );
});

afterEach(() => {
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.rmSync(targetRoot, { recursive: true, force: true });
});

describe("initProject", () => {
  it("copies autonomy templates into a target repo", () => {
    const result = initProject({ sourceRoot, targetRoot });

    expect(result.skipped).toEqual([]);
    expect(result.written).toContain("AGENTS.md");
    expect(result.written).toContain(".agents/skills/drive-autonomy/SKILL.md");
    expect(fs.existsSync(path.join(targetRoot, ".agents/autonomy.config.json"))).toBe(true);
    expect(fs.existsSync(path.join(targetRoot, ".agents/skills/drive-autonomy/SKILL.md"))).toBe(true);
    expect(fs.statSync(path.join(targetRoot, ".codex/hooks/pre-tool-use-policy.sh")).mode & 0o111).not.toBe(0);
  });

  it("copies bundled package templates when sourceRoot points at a package root", () => {
    const packageRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-autonomy-pkg-")));
    try {
      fs.mkdirSync(path.join(packageRoot, "templates/.agents/rules"), { recursive: true });
      fs.writeFileSync(path.join(packageRoot, "templates/.agents/rules/safety.md"), "# Safety\n");
      fs.writeFileSync(path.join(packageRoot, "templates/gitignore"), "node_modules/\n");

      const result = initProject({ sourceRoot: packageRoot, targetRoot });

      expect(result.written).toEqual([".agents/rules/safety.md", ".gitignore"]);
      expect(fs.existsSync(path.join(targetRoot, ".agents/rules/safety.md"))).toBe(true);
      expect(fs.readFileSync(path.join(targetRoot, ".gitignore"), "utf8")).toBe("node_modules/\n");
    } finally {
      fs.rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it("does not overwrite existing files unless forced", () => {
    fs.writeFileSync(path.join(targetRoot, "AGENTS.md"), "existing\n");

    const result = initProject({ sourceRoot, targetRoot });

    expect(result.skipped).toContain("AGENTS.md");
    expect(fs.readFileSync(path.join(targetRoot, "AGENTS.md"), "utf8")).toBe("existing\n");
  });

  it("appends the state ignore rule to an existing gitignore", () => {
    fs.writeFileSync(path.join(targetRoot, ".gitignore"), "dist/\n");

    const result = initProject({ sourceRoot, targetRoot });

    expect(result.written).toContain(".gitignore");
    expect(result.skipped).not.toContain(".gitignore");
    expect(fs.readFileSync(path.join(targetRoot, ".gitignore"), "utf8")).toContain(
      ".agents/state/"
    );
  });
});
