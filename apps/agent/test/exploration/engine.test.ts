import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExplorationEngineError,
  createExplorationEngine
} from "../../src/exploration/engine.js";
import type { ExplorationAdapter } from "../../src/exploration/types.js";

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("createExplorationEngine", () => {
  it("falls back from Stagehand to Browser Use and persists exploration.json", async () => {
    const projectRoot = createProject();
    const engine = createExplorationEngine({
      now: () => new Date("2026-05-02T00:00:00.000Z"),
      adapters: [
        failingAdapter("stagehand"),
        successfulAdapter("browser-use")
      ]
    });

    const result = await engine.explore({
      projectRoot,
      runId: "run-1",
      startUrl: "http://127.0.0.1:5173/",
      intent: { name: "checkout", acceptanceExamples: ["complete checkout"] },
      config: {
        version: "0.1",
        exploration: {
          defaultProvider: "stagehand",
          fallbackProviders: ["browser-use"],
          maxAttempts: 1,
          providers: []
        }
      }
    });

    expect(result.attempts).toEqual([
      {
        provider: "stagehand",
        attempt: 1,
        status: "failed",
        code: "adapter-failed"
      }
    ]);
    expect(result.screenModel.provider).toBe("browser-use");
    expect(result.artifactRelativePath).toBe(".playwright-workbench/runs/run-1/exploration.json");
    const persisted = JSON.parse(readFileSync(path.join(projectRoot, result.artifactRelativePath), "utf8"));
    expect(persisted).toMatchObject({
      startUrl: "http://127.0.0.1:5173/",
      provider: "browser-use",
      generatedAt: "2026-05-02T00:00:00.000Z"
    });
  });

  it("records unavailable providers and fails closed when no adapter exists", async () => {
    const projectRoot = createProject();
    const engine = createExplorationEngine({ adapters: [] });

    await expect(
      engine.explore({
        projectRoot,
        runId: "run-2",
        startUrl: "https://example.test",
        config: {
          version: "0.1",
          exploration: {
            defaultProvider: "stagehand",
            fallbackProviders: ["browser-use"],
            maxAttempts: 2,
            providers: []
          }
        }
      })
    ).rejects.toMatchObject({
      code: "EXPLORATION_ADAPTER_UNAVAILABLE",
      attempts: [
        {
          provider: "stagehand",
          attempt: 0,
          status: "unavailable",
          code: "adapter-unavailable"
        },
        {
          provider: "browser-use",
          attempt: 0,
          status: "unavailable",
          code: "adapter-unavailable"
        }
      ]
    });
  });

  it("rejects run IDs that would escape the run artifact directory", async () => {
    const projectRoot = createProject();
    const engine = createExplorationEngine({ adapters: [successfulAdapter("stagehand")] });

    await expect(
      engine.explore({
        projectRoot,
        runId: "../escape",
        startUrl: "https://example.test"
      })
    ).rejects.toBeInstanceOf(ExplorationEngineError);
  });

  it("does not write exploration artifacts through a workbench symlink", async () => {
    const projectRoot = createProject();
    const outsideRoot = mkdtempSync(path.join(tmpdir(), "pwqa-exploration-outside-"));
    tmpRoots.push(outsideRoot);
    mkdirSync(path.join(outsideRoot, "runs"), { recursive: true });
    symlinkSync(outsideRoot, path.join(projectRoot, ".playwright-workbench"));
    const engine = createExplorationEngine({ adapters: [successfulAdapter("stagehand")] });

    await expect(
      engine.explore({
        projectRoot,
        runId: "run-3",
        startUrl: "https://example.test"
      })
    ).rejects.toThrow("Exploration artifact directory is not a safe directory.");
  });

  it("redacts sensitive exploration content before returning and persisting", async () => {
    const projectRoot = createProject();
    const engine = createExplorationEngine({
      adapters: [
        {
          name: "stagehand",
          async explore(input) {
            return {
              startUrl: input.startUrl,
              steps: [
                {
                  stepId: "step-1",
                  action: "observe",
                  domSnapshot:
                    '<input type="password" value="super-secret"><div>/Users/alice/app</div><div>/home/alice/app</div><div>/etc/passwd</div><div>\\\\server\\share\\state.json</div><div>\\Users\\alice\\state.json</div><div>C:\\Users\\alice\\app</div><div>Authorization: Bearer abcdefghijklmnop</div>',
                  data: {
                    "token=sk-proj-abcdefghijklmnopqrstuvwxyz": "stored in key",
                    localPath: "/tmp/exploration-secret"
                  },
                  networkEvents: [
                    {
                      method: "GET",
                      url: "https://example.test/callback?token=secret-token&safe=1"
                    }
                  ]
                }
              ],
              observedFlows: [],
              unclear: [],
              warnings: ["sk-123456789012345678901234"]
            };
          }
        }
      ]
    });

    const result = await engine.explore({
      projectRoot,
      runId: "run-redacted",
      startUrl: "https://example.test/callback?token=secret-token"
    });

    const serialized = JSON.stringify(result.screenModel);
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("/Users/alice");
    expect(serialized).not.toContain("/home/alice");
    expect(serialized).not.toContain("/etc/passwd");
    expect(serialized).not.toContain("\\\\server\\share");
    expect(serialized).not.toContain("\\Users\\alice");
    expect(serialized).not.toContain("C:\\Users\\alice");
    expect(serialized).not.toContain("/tmp/exploration-secret");
    expect(serialized).not.toContain("abcdefghijklmnop");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("sk-123456789012345678901234");
    expect(serialized).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz");
    expect(serialized).toContain("<REDACTED>");
    expect(serialized).toContain("<REDACTED_PATH>");

    const persisted = readFileSync(path.join(projectRoot, result.artifactRelativePath), "utf8");
    expect(persisted).toBe(`${JSON.stringify(result.screenModel, null, 2)}\n`);
  });

  it("allows concurrent first writes to create safe artifact directories", async () => {
    const projectRoot = createProject();
    const engine = createExplorationEngine({ adapters: [successfulAdapter("stagehand")] });

    const [left, right] = await Promise.all([
      engine.explore({ projectRoot, runId: "run-left", startUrl: "https://example.test/left" }),
      engine.explore({ projectRoot, runId: "run-right", startUrl: "https://example.test/right" })
    ]);

    expect(left.artifactRelativePath).toBe(".playwright-workbench/runs/run-left/exploration.json");
    expect(right.artifactRelativePath).toBe(".playwright-workbench/runs/run-right/exploration.json");
  });

  it("does not overwrite an existing exploration artifact for the same runId", async () => {
    const projectRoot = createProject();
    const engine = createExplorationEngine({ adapters: [successfulAdapter("stagehand")] });

    await engine.explore({
      projectRoot,
      runId: "run-duplicate",
      startUrl: "https://example.test/first"
    });
    await expect(
      engine.explore({
        projectRoot,
        runId: "run-duplicate",
        startUrl: "https://example.test/second"
      })
    ).rejects.toThrow();
  });
});

function createProject(): string {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "pwqa-exploration-"));
  tmpRoots.push(projectRoot);
  return projectRoot;
}

function successfulAdapter(name: ExplorationAdapter["name"]): ExplorationAdapter {
  return {
    name,
    async explore(input) {
      return {
        startUrl: input.startUrl,
        steps: [
          {
            stepId: "step-1",
            action: "navigate",
            domSnapshot: "<main>Checkout</main>",
            networkEvents: []
          }
        ],
        observedFlows: [
          {
            flowId: "flow-1",
            title: "Checkout",
            stepIds: ["step-1"]
          }
        ],
        unclear: [],
        warnings: []
      };
    }
  };
}

function failingAdapter(name: ExplorationAdapter["name"]): ExplorationAdapter {
  return {
    name,
    async explore() {
      throw new Error("adapter failed");
    }
  };
}
