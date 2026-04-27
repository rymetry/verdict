import type { ProjectSummary } from "@pwqa/shared";

interface StatusbarProps {
  agentVersion: string | null;
  agentReady: boolean;
  agentEndpoint?: string;
  project: ProjectSummary | null;
  activeRunId: string | null;
  rerunEnabled: boolean;
}

export function Statusbar({
  agentVersion,
  agentReady,
  agentEndpoint = "127.0.0.1:4317",
  project,
  activeRunId,
  rerunEnabled
}: StatusbarProps) {
  const agentLabel = agentReady && agentVersion
    ? `Agent v${agentVersion}`
    : agentVersion
      ? "Agent unreachable"
      : "Connecting…";
  const projectSeg = project
    ? `project · ${project.packageManager.name}`
    : "no project";
  const runSeg = activeRunId ? `run · ${activeRunId.slice(0, 8)}` : "run · —";

  return (
    <footer className="statusbar" aria-label="Session status">
      <span className="seg">
        <span
          className="dot"
          style={{ background: agentReady ? "var(--pass)" : "var(--ink-4)" }}
          aria-hidden
        />
        <span className="agent">{agentLabel}</span>
        <span>· {agentEndpoint}</span>
      </span>
      <span className="seg">{projectSeg}</span>
      <span className="seg">{runSeg}</span>
      <span className="spacer" />
      {rerunEnabled ? (
        <span className="seg">
          <kbd>r</kbd> 再実行
        </span>
      ) : null}
    </footer>
  );
}
