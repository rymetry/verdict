import { describe, expect, it } from "vitest";
import { createAiCliAdapter } from "../src/ai/cliAdapter.js";
import type { CommandHandle, CommandResult, CommandRunner, CommandSpec } from "../src/commands/runner.js";
import type { AiAnalysisContext, AiTestGenerationContext } from "@pwqa/shared";

describe("createAiCliAdapter", () => {
  it("sends context through stdin and validates Claude JSON result output", async () => {
    let captured: CommandSpec | undefined;
    const runner = fakeRunner((spec) => {
      captured = spec;
      return JSON.stringify({
        result: JSON.stringify(validAnalysis())
      });
    });
    const adapter = createAiCliAdapter(runner);
    const analysis = await adapter.analyze({
      provider: "claude-code",
      projectRoot: "/tmp/project",
      context: baseContext()
    });
    expect(analysis.classification).toBe("test-bug");
    expect(captured?.executable).toBe("claude");
    expect(captured?.args).toEqual(["--print", "--output-format", "json"]);
    expect(captured?.stdin).toContain('"runId": "run-1"');
    expect(captured?.stdin).toContain("JSON schema:");
  });

  it("rejects malformed model output", async () => {
    const adapter = createAiCliAdapter(fakeRunner(() => JSON.stringify({ result: "{}" })));
    await expect(
      adapter.analyze({
        provider: "claude-code",
        projectRoot: "/tmp/project",
        context: baseContext()
      })
    ).rejects.toMatchObject({ code: "AI_CLI_OUTPUT_INVALID" });
  });

  it("sends generation context through stdin and validates generated test output", async () => {
    let captured: CommandSpec | undefined;
    const adapter = createAiCliAdapter(fakeRunner((spec) => {
      captured = spec;
      return JSON.stringify({
        result: JSON.stringify(validGeneratedTests())
      });
    }));

    const generated = await adapter.generateTests?.({
      provider: "claude-code",
      projectRoot: "/tmp/project",
      context: baseGenerationContext()
    });

    expect(generated?.filesTouched).toEqual(["tests/generated.spec.ts"]);
    expect(captured?.label).toBe("ai-test-generation:claude-code");
    expect(captured?.stdin).toContain('"mode": "generator"');
    expect(captured?.stdin).toContain('"locator-policy"');
    expect(captured?.stdin).toContain("Use workbenchContext AGENTS");
    expect(captured?.stdin).toContain("unified git diff");
  });

  it("classifies unsupported Claude flags from stderr", async () => {
    const adapter = createAiCliAdapter(fakeFailingRunner("error: unknown option '--output-format'"));
    await expect(
      adapter.analyze({
        provider: "claude-code",
        projectRoot: "/tmp/project",
        context: baseContext()
      })
    ).rejects.toMatchObject({ code: "AI_CLI_UNSUPPORTED_FLAG" });
  });

  it("classifies auth and quota failures separately", async () => {
    const authAdapter = createAiCliAdapter(fakeFailingRunner("not logged in"));
    await expect(
      authAdapter.analyze({
        provider: "claude-code",
        projectRoot: "/tmp/project",
        context: baseContext()
      })
    ).rejects.toMatchObject({ code: "AI_CLI_AUTH" });

    const quotaAdapter = createAiCliAdapter(fakeFailingRunner("rate limit exceeded"));
    await expect(
      quotaAdapter.analyze({
        provider: "claude-code",
        projectRoot: "/tmp/project",
        context: baseContext()
      })
    ).rejects.toMatchObject({ code: "AI_CLI_QUOTA" });
  });

  it("classifies spawn ENOENT as AI_CLI_NOT_FOUND", async () => {
    const adapter = createAiCliAdapter(fakeSpawnErrorRunner("ENOENT"));
    await expect(
      adapter.analyze({
        provider: "claude-code",
        projectRoot: "/tmp/project",
        context: baseContext()
      })
    ).rejects.toMatchObject({ code: "AI_CLI_NOT_FOUND" });
  });
});

function fakeRunner(output: (spec: CommandSpec) => string): CommandRunner {
  return {
    run(spec) {
      const stdout = output(spec);
      const result: CommandResult = {
        exitCode: 0,
        signal: null,
        startedAt: "2026-05-01T00:00:00Z",
        endedAt: "2026-05-01T00:00:01Z",
        durationMs: 1000,
        stdout,
        stderr: "",
        cancelled: false,
        timedOut: false,
        command: { executable: spec.executable, args: spec.args, cwd: spec.cwd }
      };
      return {
        result: Promise.resolve(result),
        cancel() {}
      } satisfies CommandHandle;
    }
  };
}

function fakeFailingRunner(stderr: string): CommandRunner {
  return {
    run(spec) {
      const result: CommandResult = {
        exitCode: 1,
        signal: null,
        startedAt: "2026-05-01T00:00:00Z",
        endedAt: "2026-05-01T00:00:01Z",
        durationMs: 1000,
        stdout: "",
        stderr,
        cancelled: false,
        timedOut: false,
        command: { executable: spec.executable, args: spec.args, cwd: spec.cwd }
      };
      return {
        result: Promise.resolve(result),
        cancel() {}
      } satisfies CommandHandle;
    }
  };
}

function fakeSpawnErrorRunner(code: string): CommandRunner {
  return {
    run() {
      return {
        result: Promise.reject(Object.assign(new Error(code), { code })),
        cancel() {}
      } satisfies CommandHandle;
    }
  };
}

function validAnalysis() {
  return {
    classification: "test-bug",
    rootCause: "Locator expects stale text.",
    evidence: ["stderr contains assertion mismatch"],
    risk: ["Patch touches one test file"],
    filesTouched: ["tests/example.spec.ts"],
    confidence: 0.82,
    requiresHumanDecision: false
  };
}

function baseContext(): AiAnalysisContext {
  return {
    runId: "run-1",
    projectId: "<projectRoot>",
    generatedAt: "2026-05-01T00:00:00Z",
    status: "failed",
    command: { executable: "pnpm", args: ["exec", "playwright", "test"] },
    requested: { projectId: "<projectRoot>", headed: false },
    summary: undefined,
    failures: [],
    logs: [],
    warnings: []
  };
}

function validGeneratedTests() {
  return {
    plan: ["Add coverage for checkout retry behavior."],
    proposedPatch: "diff --git a/tests/generated.spec.ts b/tests/generated.spec.ts\n",
    filesTouched: ["tests/generated.spec.ts"],
    evidence: ["failure context references checkout retry"],
    risk: ["test-only change"],
    confidence: 0.76,
    requiresHumanDecision: false
  };
}

function baseGenerationContext(): AiTestGenerationContext {
  return {
    mode: "generator",
    objective: "Add coverage for checkout retry behavior.",
    targetFiles: ["tests/generated.spec.ts"],
    analysisContext: baseContext(),
    workbenchContext: {
      agents: {
        relativePath: ".workbench/AGENTS.md",
        content: "Generate tests using project rules."
      },
      rules: [
        {
          name: "locator-policy",
          relativePath: ".workbench/rules/locator-policy.md",
          frontmatter: {},
          content: "Prefer role locators over CSS."
        }
      ],
      skills: [],
      hooks: [],
      prompts: [],
      warnings: []
    }
  };
}
