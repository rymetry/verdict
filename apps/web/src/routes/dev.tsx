// Developer View route。T900-2 で config-summary / inventory を read-only explorer に接続する。
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";
import type {
  ProjectConfigSummary,
  ProjectSummary,
  SpecFile,
  TestInventory
} from "@pwqa/shared";

import { fetchConfigSummary, fetchInventory } from "@/api/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DeveloperView } from "@/features/developer-view/DeveloperView";
import type {
  ConsoleEntry,
  FileTreeGroup,
  LocatorRow,
  LocatorState,
  RunMetadataRow,
  SourceLine
} from "@/features/developer-view/types";
import { ProjectPicker } from "@/features/project-picker/ProjectPicker";
import { useCurrentProjectQuery } from "@/hooks/use-current-project-query";
import { formatMutationError } from "@/lib/mutation-error";

import { rootRoute } from "./__root";

const EMPTY_SOURCE_LINES: ReadonlyArray<SourceLine> = [];
const EMPTY_TERMINAL_LINES: ReadonlyArray<string> = [];
const EMPTY_CONSOLE: ReadonlyArray<ConsoleEntry> = [];

function fileName(relativePath: string): string {
  const parts = relativePath.split("/");
  return parts[parts.length - 1] ?? relativePath;
}

function buildSpecItems(specs: ReadonlyArray<SpecFile>): FileTreeGroup | null {
  if (specs.length === 0) return null;
  return {
    path: "specs",
    items: specs.map((spec, index) => ({
      name: spec.relativePath,
      current: index === 0,
      annotation: `${spec.tests.length} tests`
    }))
  };
}

function buildFileTreeGroups(
  project: ProjectSummary,
  configSummary: ProjectConfigSummary,
  inventory: TestInventory
): FileTreeGroup[] {
  const groups: FileTreeGroup[] = [];
  if (configSummary.config.relativePath) {
    groups.push({
      path: "config",
      items: [{ name: configSummary.config.relativePath, annotation: "Config" }]
    });
  }

  const specs = buildSpecItems(inventory.specs);
  if (specs) groups.push(specs);

  if (configSummary.fixtureFiles.length > 0) {
    groups.push({
      path: "fixtures",
      items: configSummary.fixtureFiles.map((fixture) => ({
        name: fixture.relativePath,
        annotation: fixture.kind === "fixture-file" ? "Fixture" : "test.extend"
      }))
    });
  }

  if (configSummary.pomFiles.length > 0) {
    groups.push({
      path: "page objects",
      items: configSummary.pomFiles.map((pom) => ({
        name: pom.relativePath,
        annotation: pom.classNames[0] ?? (pom.kind === "page-object" ? "Page Object" : "Page-like")
      }))
    });
  }

  if (groups.length > 0) return groups;
  return [
    {
      path: "project",
      items: [{ name: fileName(project.rootPath), annotation: "Open" }]
    }
  ];
}

function buildLocatorState(
  configSummary: ProjectConfigSummary,
  inventory: TestInventory
): LocatorState {
  const rows: LocatorRow[] = [];

  for (const pom of configSummary.pomFiles) {
    for (const sample of pom.locatorSamples) {
      rows.push({
        key: `POM ${pom.relativePath}${sample.line ? `:L${sample.line}` : ""}`,
        value: sample.value
      });
    }
  }

  for (const spec of inventory.specs) {
    for (const test of spec.tests) {
      for (const signal of test.codeSignals ?? []) {
        if (signal.kind !== "locator" && signal.kind !== "assertion") continue;
        rows.push({
          key: `${signal.kind} ${spec.relativePath}${signal.line ? `:L${signal.line}` : ""}`,
          value: signal.value
        });
      }
    }
  }

  const visibleRows = rows.slice(0, 30);
  return {
    expression:
      visibleRows.length > 0
        ? `${rows.length} locator/assertion signals detected`
        : "No locator/assertion signals detected",
    rows: visibleRows
  };
}

function buildRunMetadata(
  project: ProjectSummary,
  configSummary: ProjectConfigSummary,
  inventory: TestInventory,
  locatorState: LocatorState
): RunMetadataRow[] {
  return [
    ["Project", fileName(project.rootPath)],
    ["Config", configSummary.config.relativePath ?? "not found"],
    ["Specs", String(inventory.totals.specFiles)],
    ["Tests", String(inventory.totals.tests)],
    ["Fixtures", String(configSummary.fixtureFiles.length)],
    ["POM files", String(configSummary.pomFiles.length)],
    ["Signals", locatorState.expression]
  ];
}

function DeveloperViewRoute(): React.ReactElement {
  const currentProjectQuery = useCurrentProjectQuery();
  const project = currentProjectQuery.data ?? null;
  const configSummaryQuery = useQuery({
    queryKey: ["projects", project?.id, "config-summary"],
    queryFn: () => fetchConfigSummary(project!.id),
    enabled: project !== null
  });
  const inventoryQuery = useQuery({
    queryKey: ["inventory", project?.id],
    queryFn: () => fetchInventory(project!.id),
    enabled: project !== null && !project.blockingExecution
  });

  if (!project) {
    return (
      <section data-testid="dev-view" aria-label="Developer View" className="mx-auto max-w-2xl">
        <ProjectPicker />
      </section>
    );
  }

  if (project.blockingExecution) {
    return (
      <section data-testid="dev-view" aria-label="Developer View" className="flex flex-col gap-4">
        <Alert variant="destructive">
          <AlertTitle>Developer explorer unavailable</AlertTitle>
          <AlertDescription>
            Project execution がブロックされているため read-only explorer は取得できません。
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const loading = configSummaryQuery.isLoading || inventoryQuery.isLoading;
  const error = configSummaryQuery.error ?? inventoryQuery.error;
  if (loading) {
    return (
      <section data-testid="dev-view" aria-label="Developer View" className="flex flex-col gap-4">
        <p className="text-sm text-[var(--ink-3)]">Loading Developer explorer…</p>
      </section>
    );
  }
  if (error) {
    return (
      <section data-testid="dev-view" aria-label="Developer View" className="flex flex-col gap-4">
        <Alert variant="destructive">
          <AlertTitle>Developer explorer failed</AlertTitle>
          <AlertDescription>
            {formatMutationError(error, "Developer explorer を取得できませんでした")}
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const configSummary = configSummaryQuery.data;
  const inventory = inventoryQuery.data;
  if (!configSummary || !inventory) {
    return (
      <section data-testid="dev-view" aria-label="Developer View" className="flex flex-col gap-4">
        <p className="text-sm text-[var(--ink-3)]">Developer explorer data is unavailable.</p>
      </section>
    );
  }

  const locator = buildLocatorState(configSummary, inventory);
  return (
    <section data-testid="dev-view" aria-label="Developer View" className="flex flex-col gap-4">
      <DeveloperView
        fileTreeGroups={buildFileTreeGroups(project, configSummary, inventory)}
        source={EMPTY_SOURCE_LINES}
        diff={EMPTY_SOURCE_LINES}
        terminal={EMPTY_TERMINAL_LINES}
        locator={locator}
        consoleEntries={EMPTY_CONSOLE}
        runMetadata={buildRunMetadata(project, configSummary, inventory, locator)}
        fileTreeBadgeLabel={null}
        locatorBadgeLabel={null}
        runMetadataBadgeLabel={null}
      />
    </section>
  );
}

export const devRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dev",
  component: DeveloperViewRoute
});
