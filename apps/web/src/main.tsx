import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import type { ProjectSummary, RunMetadata, RunRequest } from "@pwqa/shared";

// 自前ホストのフォントを globals.css より前に import する。
// FOUC 抑止に加え、`@font-face` を base layer 適用前に登録することで
// 初回フレームから正しい font-family が解決される。
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-jp/700.css";

import {
  fetchHealth,
  fetchCurrentProject,
  fetchRun,
  startRun,
  WorkbenchApiError
} from "./api/client";
import { ProjectPicker } from "./features/project-picker/ProjectPicker";
import { TestInventoryPanel } from "./features/test-inventory/TestInventoryPanel";
import { RunConsole } from "./features/run-console/RunConsole";
import { FailureReview } from "./features/failure-review/FailureReview";
import { FoundationPreview } from "./components/foundation/FoundationPreview";
import { StatusBar, TopBar } from "./components/shell";
import { deriveAgentState, deriveProjectDisplayName } from "./lib/shell-derive";
import { useWorkbenchEvents } from "./hooks/use-workbench-events";
import { useAppStore } from "./store/app-store";
import { usePersonaStore } from "./store/persona-store";
import { useRunStore } from "./store/run-store";
import { installThemeEffects } from "./store/theme-effects";

import "./styles/globals.css";
// TODO(issue-#11): δ で QA View を Tailwind 化したタイミングで削除する。
// それまでは既存 Phase 1 features の見た目を維持する目的の暫定スタイル。
import "./styles.css";

// React tree の外で 1 回だけ install する (Provider のネストを避けるため)
installThemeEffects();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: false }
  }
});

/**
 * `?foundation=1` クエリで基盤プリミティブのプレビューに切替えられる。
 * δ (Issue #11) 完了後に撤去予定 (YAGNI)。
 *
 * URL 解析で例外が起きた場合は通常 App にフォールバックする。
 * Foundation Preview に行けないだけで、実機能を白画面化させない。
 */
function isFoundationPreview(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("foundation") === "1";
  } catch {
    return false;
  }
}

function App() {
  const queryClient = useQueryClient();
  const activeRunId = useRunStore((s) => s.activeRunId);
  const lastRequest = useRunStore((s) => s.lastRequest);
  const startTracking = useRunStore((s) => s.startTracking);

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
  // refetchInterval は run 中は短く、終了済み (passed/failed/cancelled/error) は止める。
  const activeRunQuery = useQuery({
    queryKey: ["runs", activeRunId],
    queryFn: () => (activeRunId ? fetchRun(activeRunId) : Promise.resolve(null)),
    enabled: typeof activeRunId === "string" && activeRunId.length > 0,
    refetchInterval: (query) => {
      const runData = query.state.data as RunMetadata | null | undefined;
      const status = runData?.status;
      // running / queued の間は 2 秒間隔で polling、それ以外は止める
      return status === "running" || status === "queued" ? 2_000 : false;
    }
  });
  const activeRun = activeRunQuery.data ?? null;

  const project = currentProjectQuery.data ?? null;
  const agentState = deriveAgentState(healthQuery.data, healthQuery.error);

  // chrome の "再実行" は最後に投入した RunRequest をそのまま再送する。
  // running 中は disabled (RerunButton 側でも isRunning で disabled)。
  const rerunMutation = useMutation({
    mutationFn: async (request: RunRequest) => startRun(request),
    onSuccess: (response, request) => {
      startTracking(response.runId, request);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
    }
  });

  const isActiveRunRunning = activeRun?.status === "running" || activeRun?.status === "queued";

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-0)] text-[var(--ink-0)]">
      <TopBar
        projectName={project ? deriveProjectDisplayName(project.rootPath) : null}
        activeRunId={activeRunId}
        activeRunStatus={activeRun?.status ?? null}
        persona={persona}
        onPersonaChange={setPersona}
        theme={theme}
        onThemeChange={setTheme}
        canRerun={lastRequest !== null && !rerunMutation.isPending && !isActiveRunRunning}
        isRunning={rerunMutation.isPending || isActiveRunRunning}
        onRerun={() => {
          if (lastRequest !== null) rerunMutation.mutate(lastRequest);
        }}
      />

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
        agentEndpoint="127.0.0.1:4317"
        projectName={project ? deriveProjectDisplayName(project.rootPath) : null}
        packageManager={project?.packageManager.name ?? null}
        activeRunId={activeRunId}
      />
    </div>
  );
}

interface RunControlsProps {
  project: ProjectSummary | null;
}

function RunControls({ project }: RunControlsProps) {
  const queryClientLocal = useQueryClient();
  const startTracking = useRunStore((s) => s.startTracking);
  const [specPath, setSpecPath] = useState("");
  const [grep, setGrep] = useState("");

  const startMutation = useMutation({
    mutationFn: async (request: RunRequest) => startRun(request),
    onSuccess: (response, request) => {
      startTracking(response.runId, request);
      void queryClientLocal.invalidateQueries({ queryKey: ["runs"] });
    }
  });

  const errorMessage = useMemo(() => {
    if (!startMutation.error) return null;
    if (startMutation.error instanceof WorkbenchApiError) {
      return `${startMutation.error.code}: ${startMutation.error.message}`;
    }
    return startMutation.error instanceof Error
      ? startMutation.error.message
      : "Failed to start run";
  }, [startMutation.error]);

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
        <p className="errorBlock">
          Runs are blocked while the package manager status requires user resolution.
        </p>
      ) : null}
      {errorMessage ? <p className="errorBlock">{errorMessage}</p> : null}
    </article>
  );
}

// `index.html` のマウントポイント取得を明示エラーにする (null 断言はサイレント失敗を生む)
const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error('Root element "#root" not found in index.html. Cannot mount React app.');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {isFoundationPreview() ? <FoundationPreview /> : <App />}
    </QueryClientProvider>
  </StrictMode>
);
