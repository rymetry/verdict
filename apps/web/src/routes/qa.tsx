// QA View route。Phase 1 (β/η 完了時点) では「現在のメイン画面」をそのまま QA persona 用に表示する。
// δ (Issue #11) で Tailwind ベースの新 design system へ移植する予定。
//
// 構成:
//  - ProjectPicker: project root を選んで agent に開かせる
//  - RunControls: 選択 project に対して spec/grep を指定して run を起動 (form-submit mutation)
//  - TestInventoryPanel: project の test 一覧
//  - RunConsole: 進行中 run の stdout/stderr を WS 経由で表示
//  - FailureReview: active run があれば失敗詳細を出す
//
// useWorkbenchEvents は qa route 内に閉じる。WS の consumer は今のところ RunConsole のみで、
// /dev /qmo に居る間は接続を維持する必要がない (再 mount で再接続する)。
import * as React from "react";
import { createRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ProjectSummary, RunRequest } from "@pwqa/shared";

import { fetchCurrentProject } from "@/api/client";
import { FailureReview } from "@/features/failure-review/FailureReview";
import { ProjectPicker } from "@/features/project-picker/ProjectPicker";
import { RunConsole } from "@/features/run-console/RunConsole";
import { TestInventoryPanel } from "@/features/test-inventory/TestInventoryPanel";
import { useStartRunMutation } from "@/hooks/use-start-run-mutation";
import { useWorkbenchEvents } from "@/hooks/use-workbench-events";
import { formatMutationError } from "@/lib/mutation-error";
import { useRunStore } from "@/store/run-store";

import { rootRoute } from "./__root";

function QaView(): React.ReactElement {
  const activeRunId = useRunStore((s) => s.activeRunId);
  const eventStream = useWorkbenchEvents();
  const currentProjectQuery = useQuery({
    queryKey: ["projects", "current"],
    queryFn: fetchCurrentProject
  });
  const project = currentProjectQuery.data ?? null;

  return (
    <>
      <section className="grid">
        <ProjectPicker />
        <RunControls project={project} />
      </section>

      {project ? (
        <section className="grid grid-2col">
          <TestInventoryPanel project={project} />
          <RunConsole eventStream={eventStream} activeRunId={activeRunId} />
        </section>
      ) : null}

      {activeRunId ? <FailureReview runId={activeRunId} /> : null}
    </>
  );
}

interface RunControlsProps {
  project: ProjectSummary | null;
}

// QA route 内のローカル component: form submit 経路の useStartRunMutation を別 instance で取得する
// (rerun banner の `rerunMutation` と分離し、UI 表示先を独立させるため)。
// startMutation.error は React Query が保持するため、submit handler は throw に依存しない
// (silent failure 防衛)。次回入力編集時に reset し、古いエラー表示の dead-end を回避する。
// TODO(ε): `apps/web/src/features/run-controls/` に抽出し、Developer View からも独立 mount できる構造へ。
function RunControls({ project }: RunControlsProps): React.ReactElement {
  const [specPath, setSpecPath] = React.useState("");
  const [grep, setGrep] = React.useState("");

  const startMutation = useStartRunMutation();

  const errorMessage = startMutation.error
    ? formatMutationError(startMutation.error, "Failed to start run")
    : null;

  // 入力編集で前回 error を自然に解除する。dismiss CTA を増やさず古いエラーが残る silent UX を防ぐ。
  // useCallback は使わない: useMutation の戻り値は毎 render 新規参照のため memoize 効果ゼロで、
  // 「memo 化されている」と読み手に誤解させる。
  function clearErrorOnEdit(): void {
    if (startMutation.error) {
      startMutation.reset();
    }
  }

  if (!project) {
    return (
      <article className="panel">
        <p className="panelLabel">Run controls</p>
        <p className="muted">Open a project to enable runs.</p>
      </article>
    );
  }

  const blocked = project.blockingExecution;

  return (
    <article className="panel">
      <p className="panelLabel">Run controls</p>
      <form
        className="picker"
        onSubmit={(event) => {
          event.preventDefault();
          const request: RunRequest = {
            projectId: project.id,
            specPath: specPath.trim() || undefined,
            grep: grep.trim() || undefined,
            headed: false
          };
          startMutation.mutate(request);
        }}
      >
        <label htmlFor="spec-path" className="muted">
          Spec path (relative; optional)
        </label>
        <input
          id="spec-path"
          type="text"
          placeholder="tests/auth.spec.ts"
          value={specPath}
          onChange={(event) => {
            setSpecPath(event.target.value);
            clearErrorOnEdit();
          }}
        />
        <label htmlFor="grep" className="muted">
          Grep pattern (optional)
        </label>
        <input
          id="grep"
          type="text"
          placeholder="@smoke"
          value={grep}
          onChange={(event) => {
            setGrep(event.target.value);
            clearErrorOnEdit();
          }}
        />
        <button type="submit" disabled={blocked || startMutation.isPending}>
          {startMutation.isPending ? "Starting…" : "Run Playwright"}
        </button>
      </form>
      {blocked ? (
        <p role="alert" className="errorBlock">
          Runs are blocked while the package manager status requires user resolution.
        </p>
      ) : null}
      {errorMessage ? (
        <p role="alert" className="errorBlock">
          {errorMessage}
        </p>
      ) : null}
    </article>
  );
}

export const qaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/qa",
  component: QaView
});
