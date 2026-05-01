import { describe, expect, it } from "vitest";
import { createAiCliAdapter } from "../src/ai/cliAdapter.js";
import type { CommandHandle, CommandResult, CommandRunner, CommandSpec } from "../src/commands/runner.js";
import type { AiAnalysisContext } from "@pwqa/shared";

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
    expect(captured?.args).toContain("--json-schema");
    expect(captured?.stdin).toContain('"runId": "run-1"');
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
});

function fakeRunner(output: (spec: CommandSpec) => string): CommandRunner {
  return {
    run(spec) {
      const result: CommandResult = {
        exitCode: 0,
        signal: null,
        startedAt: "2026-05-01T00:00:00Z",
        endedAt: "2026-05-01T00:00:01Z",
        durationMs: 1000,
        stdout: output(spec),
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
