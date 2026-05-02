import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadWorkbench } from "../../src/workbench/index.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("loadWorkbench", () => {
  it("returns an empty context when .workbench is absent", async () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), "pwqa-workbench-loader-"));
    tmpRoots.push(projectRoot);

    const context = await loadWorkbench(projectRoot);

    expect(context).toEqual({
      skills: [],
      rules: [],
      hooks: [],
      intents: [],
      prompts: []
    });
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("does not leak the project root when the root is unreadable", async () => {
    const parentRoot = mkdtempSync(path.join(tmpdir(), "pwqa-workbench-loader-"));
    tmpRoots.push(parentRoot);
    const projectRoot = path.join(parentRoot, "missing");

    await expect(loadWorkbench(projectRoot)).rejects.toThrow(
      "Failed to load .workbench: project root is not readable"
    );

    try {
      await loadWorkbench(projectRoot);
      throw new Error("Expected loadWorkbench to reject");
    } catch (error) {
      expect((error as Error).message).not.toContain(projectRoot);
    }
  });

  it("loads a fully populated .workbench context", async () => {
    const projectRoot = createProject();
    writeWorkbenchFile(projectRoot, "AGENTS.md", "# Project context\n");
    writeWorkbenchFile(
      projectRoot,
      "skills/payment-flow/SKILL.md",
      "---\ntitle: Payment Flow\nrequiresAuth: true\n---\n# Payment Flow\n"
    );
    writeWorkbenchFile(
      projectRoot,
      "rules/locator-policy.md",
      "---\nseverity: high\n---\n# Locator Policy\n"
    );
    writeWorkbenchFile(projectRoot, "hooks/pre-generate.sh", "#!/bin/sh\nexit 0\n");
    writeWorkbenchFile(
      projectRoot,
      "intents/checkout.yaml",
      "title: Checkout\npriority: 2\ntags: [checkout, smoke]\n"
    );
    writeWorkbenchFile(projectRoot, "hooks/pre-explore.toml", "phase = \"pre-explore\"\n");
    writeWorkbenchFile(projectRoot, "hooks/pre-merge.json", "{\"phase\":\"pre-merge\"}\n");
    writeWorkbenchFile(projectRoot, "prompts/generate.md", "---\nphase: generate\n---\nGenerate tests\n");

    const context = await loadWorkbench(projectRoot);

    expect(context.agents?.relativePath).toBe(".workbench/AGENTS.md");
    expect(context.agents?.content).toContain("Project context");
    expect(context.skills).toHaveLength(1);
    expect(context.skills[0]).toMatchObject({
      name: "payment-flow",
      relativePath: ".workbench/skills/payment-flow/SKILL.md",
      frontmatter: { title: "Payment Flow", requiresAuth: true }
    });
    expect(context.rules[0]).toMatchObject({
      name: "locator-policy",
      relativePath: ".workbench/rules/locator-policy.md",
      frontmatter: { severity: "high" }
    });
    expect(context.hooks.map((hook) => hook.extension)).toEqual(["toml", "sh", "json"]);
    expect(context.hooks[1]).toMatchObject({
      name: "pre-generate",
      relativePath: ".workbench/hooks/pre-generate.sh",
      extension: "sh"
    });
    expect(context.intents[0]).toMatchObject({
      name: "checkout",
      relativePath: ".workbench/intents/checkout.yaml",
      data: { title: "Checkout", priority: 2, tags: ["checkout", "smoke"] }
    });
    expect(context.prompts[0]).toMatchObject({
      name: "generate",
      relativePath: ".workbench/prompts/generate.md",
      frontmatter: { phase: "generate" }
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.skills)).toBe(true);
    expect(Object.isFrozen(context.skills[0])).toBe(true);
  });

  it("returns a partial context when AGENTS.md is missing", async () => {
    const projectRoot = createProject();
    writeWorkbenchFile(projectRoot, "rules/wait-policy.md", "# Wait Policy\n");

    const context = await loadWorkbench(projectRoot);

    expect(context.agents).toBeUndefined();
    expect(context.rules).toHaveLength(1);
    expect(context.skills).toEqual([]);
    expect(context.hooks).toEqual([]);
    expect(context.intents).toEqual([]);
    expect(context.prompts).toEqual([]);
  });

  it("rejects malformed skill frontmatter with a project-relative path", async () => {
    const projectRoot = createProject();
    writeWorkbenchFile(projectRoot, "skills/bad/SKILL.md", "---\ntitle Bad Skill\n---\n# Bad\n");

    await expect(loadWorkbench(projectRoot)).rejects.toThrow(
      /Invalid YAML in \.workbench\/skills\/bad\/SKILL\.md/
    );

    try {
      await loadWorkbench(projectRoot);
      throw new Error("Expected loadWorkbench to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(".workbench/skills/bad/SKILL.md");
      expect((error as Error).message).not.toContain(projectRoot);
      expect((error as Error).message).not.toContain(tmpdir());
    }
  });

  it("rejects non-mapping YAML intents with a project-relative path", async () => {
    const projectRoot = createProject();
    writeWorkbenchFile(projectRoot, "intents/list.yaml", "- checkout\n- smoke\n");

    await expect(loadWorkbench(projectRoot)).rejects.toThrow(
      "Invalid YAML in .workbench/intents/list.yaml: expected a YAML mapping object"
    );
  });

  it("loads empty YAML mappings as empty metadata", async () => {
    const projectRoot = createProject();
    writeWorkbenchFile(projectRoot, "skills/empty/SKILL.md", "---\n---\n# Empty metadata\n");
    writeWorkbenchFile(projectRoot, "intents/empty.yaml", "\n# empty\n");

    const context = await loadWorkbench(projectRoot);

    expect(context.skills[0]?.frontmatter).toEqual({});
    expect(context.intents[0]?.data).toEqual({});
  });

  it("ignores backup files and backup skill directories", async () => {
    const projectRoot = createProject();
    writeWorkbenchFile(projectRoot, "skills/current/SKILL.md", "# Current\n");
    writeWorkbenchFile(projectRoot, "skills/old.backup/SKILL.md", "# Old\n");
    writeWorkbenchFile(projectRoot, "skills/old.orig/SKILL.md", "# Old\n");
    writeWorkbenchFile(projectRoot, "skills/old.pre-upgrade/SKILL.md", "# Old\n");
    writeWorkbenchFile(projectRoot, "rules/current.md", "# Current\n");
    writeWorkbenchFile(projectRoot, "rules/old.md.bak", "# Old\n");
    writeWorkbenchFile(projectRoot, "rules/old.md.orig", "# Old\n");
    writeWorkbenchFile(projectRoot, "rules/old.md~", "# Old\n");
    writeWorkbenchFile(projectRoot, "hooks/ignore.txt", "ignored\n");

    const context = await loadWorkbench(projectRoot);

    expect(context.skills.map((skill) => skill.name)).toEqual(["current"]);
    expect(context.rules.map((rule) => rule.name)).toEqual(["current"]);
  });

  it("uses only project-relative paths in parse errors", async () => {
    const projectRoot = createProject();
    writeWorkbenchFile(projectRoot, "intents/checkout.yaml", "title Checkout\n");

    await expect(loadWorkbench(projectRoot)).rejects.toThrow(".workbench/intents/checkout.yaml");

    try {
      await loadWorkbench(projectRoot);
      throw new Error("Expected loadWorkbench to reject");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain(".workbench/intents/checkout.yaml");
      expect(message).not.toContain(projectRoot);
      expect(message).not.toMatch(/\/private\/|\/var\/|\/Users\//);
    }
  });
});

function createProject(): string {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "pwqa-workbench-loader-"));
  tmpRoots.push(projectRoot);
  mkdirSync(path.join(projectRoot, ".workbench"), { recursive: true });
  return projectRoot;
}

function writeWorkbenchFile(projectRoot: string, relativePath: string, content: string): void {
  const absolutePath = path.join(projectRoot, ".workbench", relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}
