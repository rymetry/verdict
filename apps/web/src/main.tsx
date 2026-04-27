import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery
} from "@tanstack/react-query";
import type { ProjectSummary, RunRequest } from "@pwqa/shared";

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
  fetchRun
} from "./api/client";
import { ProjectPicker } from "./features/project-picker/ProjectPicker";
import { TestInventoryPanel } from "./features/test-inventory/TestInventoryPanel";
import { RunConsole } from "./features/run-console/RunConsole";
import { FailureReview } from "./features/failure-review/FailureReview";
import { FoundationPreview } from "./components/foundation/FoundationPreview";
import { ShellAlert, StatusBar, TopBar } from "./components/shell";
import { useStartRunMutation } from "./hooks/use-start-run-mutation";
import { useWorkbenchEvents } from "./hooks/use-workbench-events";
import { deriveAgentState, deriveProjectDisplayName } from "./lib/shell-derive";
import { formatMutationError } from "./lib/mutation-error";
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

// vite.config.ts の dev proxy 先と一致させているローカル Agent エンドポイント表示。
// Phase 1 はローカル固定。複数環境対応や /health からの動的取得は γ 以降の課題として残す
// (Open Questions #11 配布パッケージ設計と合わせて再検討する)。
const AGENT_ENDPOINT_DISPLAY = "127.0.0.1:4317";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: false }
  }
});

/**
 * `?foundation=1` クエリで基盤プリミティブのプレビューに切替えられる。
 * δ (Issue #11) で foundation primitives の独立確認が不要になったら撤去。
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

function App(): React.ReactElement {
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
  const [rerunErrorDismissed, setRerunErrorDismissed] = useState<unknown>(null);

  const isActiveRunRunning = activeRun?.status === "running" || activeRun?.status === "queued";
  const canRerun = lastRequest !== null && !rerunMutation.isPending && !isActiveRunRunning;

  // mutation のエラーを UI banner に反映する文字列。
  // - dismiss 後に同じエラーオブジェクトが残ってもバナー再表示しない仕掛けとして
  //   `rerunErrorDismissed` で直前 dismiss 対象を覚える。
  const rerunErrorMessage = useMemo<string | null>(() => {
    if (!rerunMutation.error) return null;
    if (rerunMutation.error === rerunErrorDismissed) return null;
    return formatMutationError(rerunMutation.error, "再実行に失敗しました");
  }, [rerunMutation.error, rerunErrorDismissed]);

  // active run 取得失敗の通知。dismiss 機能は付けず、新しい error が発生したら自然に上書きされる。
  const activeRunErrorMessage = useMemo<string | null>(() => {
    if (!activeRunQuery.error) return null;
    return formatMutationError(
      activeRunQuery.error,
      `Run #${activeRunId ?? "?"} の状態取得に失敗しました`
    );
  }, [activeRunQuery.error, activeRunId]);

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
            // canRerun=false で disabled になっている前提。ここに到達したら invariant 違反。
            throw new Error("RerunButton.onRerun: lastRequest が null のまま発火した");
          }
          rerunMutation.mutate(lastRequest);
        }}
      />

      {rerunErrorMessage ? (
        <ShellAlert
          message={rerunErrorMessage}
          onDismiss={() => setRerunErrorDismissed(rerunMutation.error)}
        />
      ) : null}
      {activeRunErrorMessage ? <ShellAlert message={activeRunErrorMessage} /> : null}

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
  const [specPath, setSpecPath] = useState("");
  const [grep, setGrep] = useState("");

  const startMutation = useStartRunMutation();

  const errorMessage = useMemo<string | null>(() => {
    if (!startMutation.error) return null;
    return formatMutationError(startMutation.error, "Failed to start run");
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
