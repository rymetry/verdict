// Developer View 全体: QA View (δ) と同じ 3-col grid で 4 つの placeholder カードを並べる。
//
// レイアウト方針:
//  - QA View (`/qa`) と同じ breakpoint 設定 (`grid-cols-1 lg:grid-cols-2 xl:grid-cols-3`) を使い、
//    Persona toggle で行き来した時の視覚的ジャンプを抑える。
//  - 列の比率も QA View と同じ `[1fr_1.1fr_0.95fr]` で、Phase 1.2 で実コンポーネントに切り替えても
//    layout が変動しないようにする。
import * as React from "react";

import { FileTreeCard } from "./FileTreeCard";
import { InspectorPanel } from "./InspectorPanel";
import { SourceTabsCard } from "./SourceTabsCard";

export function DeveloperView(): React.ReactElement {
  return (
    <div
      data-testid="dev-view-grid"
      className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.95fr)]"
    >
      <div className="flex flex-col gap-4">
        <FileTreeCard />
      </div>
      <div className="flex flex-col gap-4">
        <SourceTabsCard />
      </div>
      <InspectorPanel />
    </div>
  );
}
