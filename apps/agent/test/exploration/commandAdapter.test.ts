import { describe, expect, it } from "vitest";
import {
  createCommandExplorationAdapter,
  createConfiguredCommandExplorationAdapters
} from "../../src/exploration/commandAdapter.js";
import type { CommandHandle, CommandRunner } from "../../src/commands/runner.js";

describe("createCommandExplorationAdapter", () => {
  it("passes sanitized exploration input through stdin and parses screen model output", async () => {
    let stdin = "";
    const runner = fakeRunner({
      stdout: JSON.stringify({
        startUrl: "http://127.0.0.1:5173/",
        steps: [],
        observedFlows: [],
        unclear: [],
        warnings: []
      }),
      captureStdin(value) {
        stdin = value;
      }
    });
    const adapter = createCommandExplorationAdapter({
      name: "stagehand",
      command: { executable: "node", args: ["scripts/explore.mjs"] },
      runner
    });

    const output = await adapter.explore({
      projectRoot: "/repo",
      provider: "stagehand",
      startUrl: "http://127.0.0.1:5173/",
      intent: { name: "checkout" }
    });

    expect(JSON.parse(stdin)).toEqual({
      provider: "stagehand",
      startUrl: "http://127.0.0.1:5173/",
      intent: { name: "checkout" }
    });
    expect(output.steps).toEqual([]);
  });

  it("rejects invalid adapter output", async () => {
    const adapter = createCommandExplorationAdapter({
      name: "browser-use",
      command: { executable: "python", args: ["explore.py"] },
      runner: fakeRunner({ stdout: "{}" })
    });

    await expect(
      adapter.explore({
        projectRoot: "/repo",
        provider: "browser-use",
        startUrl: "https://example.test"
      })
    ).rejects.toMatchObject({ code: "EXPLORATION_COMMAND_OUTPUT_INVALID" });
  });

  it("creates command adapters only for enabled configured providers", () => {
    const adapters = createConfiguredCommandExplorationAdapters({
      runner: fakeRunner({ stdout: "{}" }),
      config: {
        version: "0.1",
        exploration: {
          defaultProvider: "stagehand",
          fallbackProviders: ["browser-use"],
          maxAttempts: 2,
          providers: [
            {
              name: "stagehand",
              enabled: false,
              command: { executable: "node", args: ["stagehand.mjs"] }
            },
            {
              name: "browser-use",
              enabled: true,
              command: { executable: "python", args: ["browser_use.py"] }
            }
          ]
        }
      }
    });

    expect(adapters.map((adapter) => adapter.name)).toEqual(["browser-use"]);
  });
});

function fakeRunner(input: {
  stdout: string;
  exitCode?: number;
  captureStdin?: (stdin: string) => void;
}): CommandRunner {
  return {
    run(spec): CommandHandle {
      input.captureStdin?.(spec.stdin ?? "");
      return {
        result: Promise.resolve({
          exitCode: input.exitCode ?? 0,
          signal: null,
          startedAt: "2026-05-02T00:00:00.000Z",
          endedAt: "2026-05-02T00:00:00.001Z",
          durationMs: 1,
          stdout: input.stdout,
          stderr: "",
          cancelled: false,
          timedOut: false,
          command: {
            executable: spec.executable,
            args: spec.args,
            cwd: spec.cwd
          }
        }),
        cancel() {
          // no-op fake
        }
      };
    }
  };
}
