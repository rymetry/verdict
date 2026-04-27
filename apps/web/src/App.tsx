// main.tsx (entry) と分離する理由:
//  - SRP: entry は Provider / font / root mount のみ。app-shell ロジックは本ファイルに集約
//  - 統合テスト容易性: 命名一致した named export `App` を test/App.test.tsx から直接 render
//    し、entry 側の副作用 (font import / installThemeEffects / root mount) を含めずに検証する
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProjectSummary, RunRequest } from "@pwqa/shared";

import { fetchCurrentProject, fetchHealth, fetchRun } from "@/api/client";
import { ProjectPicker } from "@/features/project-picker/ProjectPicker";
import { TestInventoryPanel } from "@/features/test-inventory/TestInventoryPanel";
import { RunConsole } from "@/features/run-console/RunConsole";
import { FailureReview } from "@/features/failure-review/FailureReview";
import { ShellAlert, StatusBar, TopBar } from "@/components/shell";
import { useStartRunMutation } from "@/hooks/use-start-run-mutation";
import { useWorkbenchEvents } from "@/hooks/use-workbench-events";
import { deriveAgentState, deriveProjectDisplayName } from "@/lib/shell-derive";
import { formatMutationError } from "@/lib/mutation-error";
import { useAppStore } from "@/store/app-store";
import { usePersonaStore } from "@/store/persona-store";
import { useRunStore } from "@/store/run-store";

// vite.config.ts の dev proxy 先と一致させているローカル Agent エンドポイント表示。
// Phase 1 はローカル固定。複数環境対応や /health からの動的取得は γ 以降の課題として残す。
const AGENT_ENDPOINT_DISPLAY = "127.0.0.1:4317";

export function App(): React.ReactElement {
  const queryClient = useQueryClient();
  const activeRunId = useRunStore((s) => s.activeRunId);
  const lastRequest = useRunStore((s) => s.lastRequest);
  const clearActiveRun = useRunStore((s) => s.clearActive);

  const persona = usePersonaStore((s) => s.persona);
  const setPersona = usePersonaStore((s) => s.setPersona);

  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const eventStream = useWorkbenchEvents();

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 5_000
  });

  const currentProjectQuery = useQuery({
    queryKey: ["projects", "current"],
    queryFn: fetchCurrentProject
  });

  // active run のメタ (status / 完了時刻 等) を取得し、TopBar の status badge に反映する。
  // - queryFn は activeRunId が string であることを enabled でゲートしてから呼ぶ。
  //   TanStack v5 内部で enabled は信頼できるが、defense-in-depth として queryFn 内でも
  //   type guard を入れ、万一 enabled が破られた場合は silent return ではなく throw して可視化する。
  // - refetchInterval は run 中 (running / queued) は 2 秒、それ以外は止める。
  const activeRunQuery = useQuery({
    queryKey: ["runs", activeRunId],
    queryFn: () => {
      // type guard で string への narrowing を有効化 (fetchRun は string 必須)
      if (typeof activeRunId !== "string" || activeRunId.length === 0) {
        throw new Error("activeRunQuery: activeRunId が不正なまま queryFn が呼ばれた");
      }
      return fetchRun(activeRunId);
    },
    enabled: typeof activeRunId === "string" && activeRunId.length > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "queued" ? 2_000 : false;
    }
  });
  const activeRun = activeRunQuery.data ?? null;

  const project = currentProjectQuery.data ?? null;
  const projectDisplayName = project ? deriveProjectDisplayName(project.rootPath) : null;
  const agentState = deriveAgentState(healthQuery.data, healthQuery.error);

  // shell 上の "再実行" は最後に投入した RunRequest を再送する。
  // running 中は disabled (RerunButton 側でも isRunning 表示)。
  // Phase 1 では server に専用 rerun endpoint を持たないため client で lastRequest を保持して再送する。
  // (専用 endpoint 採用は γ 以降の Open Question として別途 PLAN.v2 に追記する課題)
  const rerunMutation = useStartRunMutation();

  const isActiveRunRunning = activeRun?.status === "running" || activeRun?.status === "queued";
  const canRerun = lastRequest !== null && !rerunMutation.isPending && !isActiveRunRunning;

  // mutation のエラーを UI banner に反映する文字列。
  // - dismiss は `rerunMutation.reset()` で React Query 側 error を直接クリアする。
  //   独自に dismiss state を持つと caller (mutate) と responder (dismiss) で
  //   error 状態の source-of-truth が分裂し、retry / 同種エラー再発時に silent regression を起こす。
  // - 失敗回数が変わるたびに ShellAlert を再 mount するため `key={failureCount}` を付与し、
  //   role="alert" の re-announce + 視覚フィードバック (フリッカー) を効かせる。
  const rerunErrorMessage = rerunMutation.error
    ? formatMutationError(rerunMutation.error, "再実行に失敗しました")
    : null;

  // active run 取得失敗の通知。
  // dismiss は **active run の追跡を停止** する設計:
  //   `refetch()` だと server がまだ落ちている場合 banner が即座に再表示され UX dead-end になる。
  //   `removeQueries` だけでも `enabled=true` のまま即時 refetch されて同じ問題が起きる。
  //   `clearActive()` で activeRunId を null にすれば query は disabled になり banner も消える
  //   (= ユーザが「この run はもう追わなくて良い」と意思表示する dismiss セマンティクス)。
  const activeRunErrorMessage = activeRunQuery.error
    ? formatMutationError(
        activeRunQuery.error,
        `Run #${activeRunId ?? "?"} の状態取得に失敗しました`
      )
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-0)] text-[var(--ink-0)]">
      <TopBar
        projectName={projectDisplayName}
        activeRunId={activeRunId}
        activeRunStatus={activeRun?.status ?? null}
        persona={persona}
        onPersonaChange={setPersona}
        theme={theme}
        onThemeChange={setTheme}
        canRerun={canRerun}
        isRunning={rerunMutation.isPending || isActiveRunRunning}
        onRerun={() => {
          if (lastRequest === null) {
            // canRerun=false で disabled になっている前提。invariant 違反だが、
            // event handler 内 throw は React Error Boundary に拾われず production で silent
            // (window.onerror 経由) になりうる。安全な no-op + console.error で可視化する。
            // eslint-disable-next-line no-console -- invariant 違反は production でも検知したい
            console.error("[App] RerunButton.onRerun: lastRequest=null with canRerun=true");
            return;
          }
          rerunMutation.mutate(lastRequest);
        }}
      />

      {rerunErrorMessage ? (
        <ShellAlert
          // 失敗回数が変わるたびに DOM を再 mount し、role="alert" を再 announce + 視覚フリッカーを起こす
          key={`rerun-${rerunMutation.failureCount}`}
          message={rerunErrorMessage}
          onDismiss={() => rerunMutation.reset()}
        />
      ) : null}
      {activeRunErrorMessage ? (
        <ShellAlert
          key={`active-run-${activeRunQuery.failureCount}`}
          message={activeRunErrorMessage}
          // dismiss は 2 段操作:
          //   (1) `clearActive()` で activeRunId を null にし、`enabled=false` で query を停止
          //   (2) `removeQueries` で stale な error cache を破棄し、次回 run 開始時に新規 lifecycle で取り直す
          // 順序は **cancelQueries → state 更新 → removeQueries** で in-flight refetch race を回避。
          onDismiss={() => {
            const dismissedId = activeRunId;
            if (dismissedId) {
              // in-flight refetch があれば cancel してから cache を消す (race 対策)
              void queryClient.cancelQueries({ queryKey: ["runs", dismissedId], exact: true });
            }
            clearActiveRun();
            if (dismissedId) {
              queryClient.removeQueries({ queryKey: ["runs", dismissedId], exact: true });
            }
          }}
        />
      ) : null}

      <main className="shell flex-1">
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
      </main>

      <StatusBar
        agentState={agentState}
        agentVersion={healthQuery.data?.version}
        agentEndpoint={AGENT_ENDPOINT_DISPLAY}
        projectName={projectDisplayName}
        packageManager={project?.packageManager.name ?? null}
        activeRunId={activeRunId}
      />
    </div>
  );
}

interface RunControlsProps {
  project: ProjectSummary | null;
}

// App と同ファイル: form submit 経路の useStartRunMutation を別 instance で取得する
// (rerun banner の `rerunMutation` と分離し、UI 表示先を独立させるため)。
// startMutation.error は React Query が保持するため、submit handler は throw に依存しない
// (silent failure 防衛)。次回入力編集時に reset し、古いエラー表示の dead-end を回避する。
// TODO(ε): `apps/web/src/features/run-controls/` に抽出し、QA View からも独立 mount できる構造へ。
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
