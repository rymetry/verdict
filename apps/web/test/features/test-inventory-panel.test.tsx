// TestInventoryPanel の振る舞い: blocked / loading / error / empty / 一覧表示。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectSummary, TestInventory } from "@pwqa/shared";

import { TestInventoryPanel } from "@/features/test-inventory/TestInventoryPanel";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, fetchInventory: vi.fn() };
});
import { fetchInventory } from "@/api/client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeProject(over: Partial<ProjectSummary> = {}): ProjectSummary {
  const base: ProjectSummary = {
    id: "p1",
    rootPath: "/p",
    packageJsonPath: "/p/package.json",
    packageManager: {
      name: "pnpm",
      status: "ok",
      confidence: "high",
      reason: "fixture",
      warnings: [],
      errors: [],
      lockfiles: ["pnpm-lock.yaml"],
      commandTemplates: {
        playwrightTest: { executable: "pnpm", args: ["exec", "playwright", "test"] }
      },
      hasPlaywrightDevDependency: true,
      localBinaryUsable: true,
      blockingExecution: false
    },
    hasAllurePlaywright: false,
    hasAllureCli: false,
    warnings: [],
    blockingExecution: false
  };
  return { ...base, ...over };
}

function renderPanel(project: ProjectSummary): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TestInventoryPanel project={project} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.mocked(fetchInventory).mockReset();
});

describe("TestInventoryPanel", () => {
  it("blocking のときは inventory を取得せず案内文を出す", () => {
    renderPanel(makeProject({ blockingExecution: true }));
    expect(screen.getByText(/Project execution がブロック/)).toBeInTheDocument();
    expect(vi.mocked(fetchInventory)).not.toHaveBeenCalled();
  });

  it("loading 中は spinner 文言を出す", () => {
    vi.mocked(fetchInventory).mockReturnValue(new Promise(() => {}));
    renderPanel(makeProject());
    expect(screen.getByText(/Listing tests via Playwright CLI/)).toBeInTheDocument();
  });

  it("error 時は Alert で表示する + console.error を残す", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetchInventory).mockRejectedValue(new Error("ENOENT"));
    renderPanel(makeProject());
    expect(await screen.findByText("取得失敗")).toBeInTheDocument();
    expect(screen.getByText("ENOENT")).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("inventory.error フィールドは Playwright list error として表示する", async () => {
    const inv: TestInventory = {
      projectId: "p1",
      source: "playwright-list-json",
      generatedAt: "2026-04-28T00:00:00Z",
      specs: [],
      totals: { specFiles: 0, tests: 0 },
      warnings: [],
      error: "playwright cli failed"
    };
    vi.mocked(fetchInventory).mockResolvedValue(inv);
    renderPanel(makeProject());
    expect(await screen.findByText("Playwright list error")).toBeInTheDocument();
    expect(screen.getByText("playwright cli failed")).toBeInTheDocument();
  });

  it("empty な specs は案内文を出す", async () => {
    const inv: TestInventory = {
      projectId: "p1",
      source: "playwright-list-json",
      generatedAt: "2026-04-28T00:00:00Z",
      specs: [],
      totals: { specFiles: 0, tests: 0 },
      warnings: []
    };
    vi.mocked(fetchInventory).mockResolvedValue(inv);
    renderPanel(makeProject());
    expect(await screen.findByText(/spec が見つかりませんでした/)).toBeInTheDocument();
  });

  it("specs を file 単位に列挙し test title / line / tags も出す", async () => {
    const inv: TestInventory = {
      projectId: "p1",
      source: "playwright-list-json",
      generatedAt: "2026-04-28T00:00:00Z",
      specs: [
        {
          filePath: "/p/tests/auth.spec.ts",
          relativePath: "tests/auth.spec.ts",
          tests: [
            {
              id: "t1",
              title: "should login",
              fullTitle: "auth > should login",
              filePath: "/p/tests/auth.spec.ts",
              relativePath: "tests/auth.spec.ts",
              line: 12,
              column: 0,
              describePath: [],
              tags: ["@smoke"],
              qaMetadata: {
                purpose: "auth > should login",
                steps: [],
                expectations: [],
                source: "playwright-list-json",
                confidence: "low"
              }
            },
            {
              id: "t2",
              title: "should reject",
              fullTitle: "auth > should reject",
              filePath: "/p/tests/auth.spec.ts",
              relativePath: "tests/auth.spec.ts",
              line: 30,
              column: 0,
              describePath: [],
              tags: [],
              qaMetadata: {
                purpose: "auth > should reject",
                steps: [],
                expectations: [],
                source: "playwright-list-json",
                confidence: "low"
              }
            }
          ]
        }
      ],
      totals: { specFiles: 1, tests: 2 },
      warnings: []
    };
    vi.mocked(fetchInventory).mockResolvedValue(inv);
    renderPanel(makeProject());
    expect(await screen.findByText("tests/auth.spec.ts")).toBeInTheDocument();
    expect(screen.getByText("should login")).toBeInTheDocument();
    expect(screen.getByText("L12")).toBeInTheDocument();
    expect(screen.getByText("@smoke")).toBeInTheDocument();
    // header の summary
    expect(screen.getByText(/1 files · 2 tests/)).toBeInTheDocument();
  });
});
