import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import type { ProjectSummary, RunRequest } from "@pwqa/shared";
import {
  fetchHealth,
  fetchCurrentProject,
  startRun,
  WorkbenchApiError
} from "./api/client";
import { connectWorkbenchEvents, type EventStream } from "./api/events";
import { ProjectPicker } from "./features/project-picker/ProjectPicker";
import { TestInventoryPanel } from "./features/test-inventory/TestInventoryPanel";
import { RunConsole } from "./features/run-console/RunConsole";
import { FailureReview } from "./features/failure-review/FailureReview";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: false }
  }
});

function App() {
  const [activeRunId, setActiveRunId] = useState<string | undefined>(undefined);
  const [eventStream] = useState<EventStream>(() => connectWorkbenchEvents());

  useEffect(() => () => eventStream.close(), [eventStream]);

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 5_000
  });

  const currentProjectQuery = useQuery({
    queryKey: ["projects", "current"],
    queryFn: fetchCurrentProject
  });

  const project = currentProjectQuery.data ?? null;

  return (
    <main className="shell">
      <header className="topbar" aria-label="Workbench status">
        <div>
          <p className="eyebrow">Local control plane</p>
          <h1>Playwright Workbench</h1>
        </div>
        <div className={healthQuery.data?.ok ? "status statusReady" : "status statusPending"}>
          <span aria-hidden="true" />
          {healthQuery.data?.ok
            ? `Agent v${healthQuery.data.version}`
            : healthQuery.error
              ? "Agent unreachable"
              : "Connecting…"}
        </div>
      </header>

      <section className="grid">
        <ProjectPicker />
        <RunControls
          project={project}
          onRunStarted={(id) => setActiveRunId(id)}
        />
      </section>

      {project ? (
        <section className="grid grid-2col">
          <TestInventoryPanel project={project} />
          <RunConsole eventStream={eventStream} activeRunId={activeRunId} />
        </section>
      ) : null}

      {activeRunId ? <FailureReview runId={activeRunId} /> : null}
    </main>
  );
}

interface RunControlsProps {
  project: ProjectSummary | null;
  onRunStarted: (runId: string) => void;
}

function RunControls({ project, onRunStarted }: RunControlsProps) {
  const queryClientLocal = useQueryClient();
  const [specPath, setSpecPath] = useState("");
  const [grep, setGrep] = useState("");

  const startMutation = useMutation({
    mutationFn: async (request: RunRequest) => startRun(request),
    onSuccess: (response) => {
      onRunStarted(response.runId);
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
