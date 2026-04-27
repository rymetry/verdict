// app-shell + Phase 1 features をマウントするルートコンポーネント。
// main.tsx から分離した理由:
//  - rerun banner / activeRun query / persona / theme の配線が増え、main.tsx に直書きすると
//    エントリポイント (root mount, Provider 設置) と App ロジックが mix されて読みづらい
//  - integration test (`apps/web/test/App.test.tsx`) で QueryClientProvider と一緒に
//    render するために named export が必要
import * as React from "react";
import { useState } from "react";
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
  const activeRunId = useRunStore((s) => s.activeRunId);
  const lastRequest = useRunStore((s) => s.lastRequest);

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
  // - queryFn は activeRunId が文字列前提。enabled で完全にゲートし、null fallback パターンは廃止。
  // - refetchInterval は run 中 (running / queued) は 2 秒、それ以外は止める。
  const isActiveRunIdValid = typeof activeRunId === "string" && activeRunId.length > 0;
  const activeRunQuery = useQuery({
    queryKey: ["runs", activeRunId],
    queryFn: () => {
      if (!isActiveRunIdValid) {
        // enabled で防いでいる invariant 違反 (silent return ではなく明示的に throw)
        throw new Error("activeRunQuery: activeRunId が不正なまま queryFn が呼ばれた");
      }
      return fetchRun(activeRunId);
    },
    enabled: isActiveRunIdValid,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "queued" ? 2_000 : false;
    }
  });
  const activeRun = activeRunQuery.data ?? null;

  const project = currentProjectQuery.data ?? null;
  const projectDisplayName = project ? deriveProjectDisplayName(project.rootPath) : null;
  const agentState = deriveAgentState(healthQuery.data, healthQuery.error);

  // chrome の "再実行" は最後に投入した RunRequest を再送する。
  // running 中は disabled (RerunButton 側でも isRunning 表示)。
  // server 側に専用 rerun endpoint が無いため client で lastRequest を保持して再送する設計。
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

  // active run 取得失敗の通知。dismiss 機能は付けず、新しい error が発生したら自然に上書きされる。
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

function RunControls({ project }: RunControlsProps): React.ReactElement {
  const queryClient = useQueryClient();
  const [specPath, setSpecPath] = useState("");
  const [grep, setGrep] = useState("");

  const startMutation = useStartRunMutation();

  const errorMessage = startMutation.error
    ? formatMutationError(startMutation.error, "Failed to start run")
    : null;

  // queryClient は cache 操作のために hooks 規約遵守目的で取得 (現状は useStartRunMutation 内で利用済)
  void queryClient;

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
          onChange={(event) => setSpecPath(event.target.value)}
        />
        <label htmlFor="grep" className="muted">
          Grep pattern (optional)
        </label>
        <input
          id="grep"
          type="text"
          placeholder="@smoke"
          value={grep}
          onChange={(event) => setGrep(event.target.value)}
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
