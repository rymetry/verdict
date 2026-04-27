import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery
} from "@tanstack/react-query";
import {
  RunCompletedPayloadSchema,
  type RunRequest,
  type RunStatus
} from "@pwqa/shared";
import { fetchHealth, fetchCurrentProject, startRun } from "./api/client";
import { connectWorkbenchEvents, type EventStream } from "./api/events";
import { Chrome } from "./components/Chrome";
import { Statusbar } from "./components/Statusbar";
import { useTheme } from "./components/ThemeToggle";
import type { Persona } from "./components/PersonaToggle";
import { QAView } from "./views/QAView";
import { DeveloperView } from "./views/DeveloperView";
import { InsightsView } from "./views/InsightsView";
import "./styles/index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: false }
  }
});

function App() {
  const [persona, setPersona] = useState<Persona>("qa");
  const [theme, setTheme] = useTheme();
  const [activeRunId, setActiveRunId] = useState<string | undefined>(undefined);
  const [activeRunStatus, setActiveRunStatus] = useState<RunStatus | null>(null);
  const [lastRequest, setLastRequest] = useState<RunRequest | null>(null);
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

  // Track active run status via event stream (for Chrome breadcrumb badge).
  useEffect(() => {
    if (!activeRunId) {
      setActiveRunStatus(null);
      return;
    }
    setActiveRunStatus("running");
    const unsubscribe = eventStream.subscribe((event) => {
      if (event.runId !== activeRunId) return;
      if (event.type === "run.queued" || event.type === "run.started") {
        setActiveRunStatus("running");
        return;
      }
      if (event.type === "run.completed") {
        const parsed = RunCompletedPayloadSchema.safeParse(event.payload);
        if (parsed.success) setActiveRunStatus(parsed.data.status);
        return;
      }
      if (event.type === "run.cancelled") setActiveRunStatus("cancelled");
      if (event.type === "run.error") setActiveRunStatus("error");
    });
    return () => {
      unsubscribe();
    };
  }, [eventStream, activeRunId]);

  const rerunMutation = useMutation({
    mutationFn: async (request: RunRequest) => startRun(request),
    onSuccess: (response) => setActiveRunId(response.runId)
  });

  const handleRunStarted = (runId: string, request: RunRequest) => {
    setActiveRunId(runId);
    setLastRequest(request);
  };

  const handleRerun = () => {
    if (!lastRequest) return;
    rerunMutation.mutate(lastRequest);
  };

  const agentReady = Boolean(healthQuery.data?.ok);
  const agentVersion = healthQuery.data?.ok ? healthQuery.data.version : null;
  const rerunDisabled = !lastRequest || rerunMutation.isPending;

  // Global keyboard shortcut: `r` to re-run last request (when one exists
  // and an input is not focused).
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
    }
    function handler(event: KeyboardEvent) {
      if (event.key !== "r") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (rerunDisabled) return;
      event.preventDefault();
      handleRerun();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [rerunDisabled, lastRequest]);

  return (
    <>
      <Chrome
        project={project}
        activeRunId={activeRunId ?? null}
        activeRunStatus={activeRunStatus}
        persona={persona}
        theme={theme}
        onPersonaChange={setPersona}
        onThemeChange={setTheme}
        onRerun={handleRerun}
        rerunDisabled={rerunDisabled}
        rerunLabel={rerunMutation.isPending ? "Starting…" : "再実行"}
      />

      <main className="workspace" data-view={persona}>
        {persona === "qa" ? (
          <QAView
            project={project}
            activeRunId={activeRunId}
            eventStream={eventStream}
            onRunStarted={handleRunStarted}
          />
        ) : null}
        {persona === "dev" ? <DeveloperView /> : null}
        {persona === "qmo" ? <InsightsView /> : null}
      </main>

      <Statusbar
        agentVersion={agentVersion}
        agentReady={agentReady}
        project={project}
        activeRunId={activeRunId ?? null}
        rerunEnabled={!rerunDisabled}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
