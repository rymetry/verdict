// Developer View 全体: QA View (δ) と同じ 3-col grid で 4 つの placeholder カードを並べる。
//
// レイアウト方針:
//  - QA View (`/qa`) と同じ breakpoint / 列比率設定を流用し、Persona toggle で行き来した時の
//    視覚的ジャンプを抑える。Phase 1.2 で実コンポーネントに切り替えても layout が変動しない。
import * as React from "react";

import { FileTreeCard } from "./FileTreeCard";
import { InspectorPanel } from "./InspectorPanel";
import { SourceTabsCard } from "./SourceTabsCard";
import type {
  ConsoleEntry,
  FileTreeGroup,
  LocatorState,
  RunMetadataRow,
  SourceLine
} from "./types";

interface DeveloperViewProps {
  fileTreeGroups: ReadonlyArray<FileTreeGroup>;
  source: ReadonlyArray<SourceLine>;
  diff: ReadonlyArray<SourceLine>;
  terminal: ReadonlyArray<string>;
  locator: LocatorState;
  consoleEntries: ReadonlyArray<ConsoleEntry>;
  runMetadata: ReadonlyArray<RunMetadataRow>;
}

export function DeveloperView({
  fileTreeGroups,
  source,
  diff,
  terminal,
  locator,
  consoleEntries,
  runMetadata
}: DeveloperViewProps): React.ReactElement {
  return (
    <div
      data-testid="dev-view-grid"
      className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.95fr)]"
    >
      <div className="flex flex-col gap-4">
        <FileTreeCard groups={fileTreeGroups} />
      </div>
      <div className="flex flex-col gap-4">
        <SourceTabsCard source={source} diff={diff} terminal={terminal} />
      </div>
      <InspectorPanel
        locator={locator}
        consoleEntries={consoleEntries}
        runMetadata={runMetadata}
      />
    </div>
  );
}
