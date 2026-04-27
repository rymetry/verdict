// QA View route。Issue #11 (δ) で Tailwind + shadcn primitives 化した 3-col layout に組み直す。
//
// 構成:
//  - プロジェクト未オープン時: ProjectPicker のみを中央寄せで描画 (3-col grid を組まない)。
//    Run controls / inventory / failure review は project が前提のため、3-col grid を空欄で
//    出すと UX が "何もできない" 印象を与える。
//  - プロジェクト open 後:
//      Left  col: ProjectPicker + TestInventoryPanel
//      Center col: RunControls + RunConsole
//      Right col: FailureReview (active run があるときのみ)
//    `docs/design/concept-b-refined.html` の QA View 3-col 縦割りを Phase 1 機能セットに当てはめる。
//
// WebSocket は __root から WorkbenchEventsContext 経由で受け取る (δ で Root scope に singleton 化)。
import * as React from "react";
import { createRoute } from "@tanstack/react-router";

import { FailureReview } from "@/features/failure-review/FailureReview";
import { ProjectPicker } from "@/features/project-picker/ProjectPicker";
import { RunConsole } from "@/features/run-console/RunConsole";
import { RunControls } from "@/features/run-controls/RunControls";
import { TestInventoryPanel } from "@/features/test-inventory/TestInventoryPanel";
import { useCurrentProjectQuery } from "@/hooks/use-current-project-query";
import { useWorkbenchEventStream } from "@/hooks/workbench-events-context";
import { useRunStore } from "@/store/run-store";

import { rootRoute } from "./__root";

function QaView(): React.ReactElement {
  const activeRunId = useRunStore((s) => s.activeRunId);
  const eventStream = useWorkbenchEventStream();
  const currentProjectQuery = useCurrentProjectQuery();
  const project = currentProjectQuery.data ?? null;

  if (!project) {
    return (
      <div className="mx-auto max-w-2xl">
        <ProjectPicker />
      </div>
    );
  }

  // Phase 1: project open 後の 3-col。Right col は active run があるときだけ表示するが、
  // grid の列数を変えると左右の幅が揺れるため列数は常に 3 で、無いときは右列を空に保つ。
  // breakpoint: 1280px 以上で 3-col、未満では 1 列に折り返す (lg: 2-col)。
  return (
    <div
      data-testid="qa-view-grid"
      className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.95fr)]"
    >
      <div className="flex flex-col gap-4">
        <ProjectPicker />
        <TestInventoryPanel project={project} />
      </div>
      <div className="flex flex-col gap-4">
        <RunControls project={project} />
        <RunConsole eventStream={eventStream} activeRunId={activeRunId} />
      </div>
      <div className="flex flex-col gap-4">
        <FailureReview runId={activeRunId} />
      </div>
    </div>
  );
}

export const qaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/qa",
  component: QaView
});
