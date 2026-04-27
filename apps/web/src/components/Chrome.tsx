import type { ReactNode } from "react";
import type { ProjectSummary, RunStatus } from "@pwqa/shared";
import { PersonaToggle, type Persona } from "./PersonaToggle";
import { ThemeToggle, type Theme } from "./ThemeToggle";
import {
  BranchIcon,
  ClockIcon,
  ExternalIcon,
  FolderIcon,
  PlayIcon
} from "./icons";

interface ChromeProps {
  project: ProjectSummary | null;
  activeRunId: string | null;
  activeRunStatus: RunStatus | null;
  persona: Persona;
  theme: Theme;
  onPersonaChange: (next: Persona) => void;
  onThemeChange: (next: Theme) => void;
  onRerun?: () => void;
  rerunDisabled?: boolean;
  rerunLabel?: string;
  primaryAction?: ReactNode;
}

export function Chrome({
  project,
  activeRunId,
  activeRunStatus,
  persona,
  theme,
  onPersonaChange,
  onThemeChange,
  onRerun,
  rerunDisabled,
  rerunLabel,
  primaryAction
}: ChromeProps) {
  const projectName = project ? deriveProjectName(project.rootPath) : "no project";
  const branchLabel = "main";
  const runLabel = activeRunId ? `Run ${activeRunId.slice(0, 8)}` : "no run";
  const runBadge = activeRunStatus ? statusToBadge(activeRunStatus) : null;

  return (
    <header className="chrome">
      <div className="brand">
        <span className="brand-mark">P</span>
        <div>
          <h1 className="brand-name">Playwright Workbench</h1>
          <span className="brand-sub">v0.1.0 · local</span>
        </div>
      </div>

      <nav className="breadcrumbs" aria-label="Project context">
        <span className="crumb">
          <FolderIcon />
          {projectName}
        </span>
        <span className="crumb-divider">/</span>
        <span className="crumb">
          <BranchIcon />
          {branchLabel}
        </span>
        <span className="crumb-divider">/</span>
        <span className="crumb">
          <ClockIcon />
          {runLabel}
          {runBadge ? (
            <span className={`badge ${runBadge.cls}`} style={{ marginLeft: 4 }}>
              {runBadge.label}
            </span>
          ) : null}
        </span>
      </nav>

      <div className="chrome-actions">
        <PersonaToggle persona={persona} onChange={onPersonaChange} />

        {primaryAction ?? (
          <button
            className="btn btn-icon"
            type="button"
            aria-label="Open in editor"
            title="エディタで開く"
          >
            <ExternalIcon />
          </button>
        )}

        <button
          className="btn btn-primary"
          type="button"
          onClick={onRerun}
          disabled={rerunDisabled}
          title="再実行"
        >
          <PlayIcon />
          {rerunLabel ?? "再実行"}
        </button>

        <ThemeToggle theme={theme} onChange={onThemeChange} />
      </div>
    </header>
  );
}

function deriveProjectName(rootPath: string): string {
  const parts = rootPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "project";
}

function statusToBadge(status: RunStatus): { cls: string; label: string } {
  switch (status) {
    case "queued":
    case "running":
      return { cls: "running", label: "Running" };
    case "passed":
      return { cls: "passed", label: "Passed" };
    case "failed":
      return { cls: "failed", label: "Failed" };
    case "cancelled":
      return { cls: "skipped", label: "Cancelled" };
    case "error":
      return { cls: "failed", label: "Error" };
  }
}
