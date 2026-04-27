import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCurrentProject, openProject, WorkbenchApiError } from "../../api/client";
import type { ProjectSummary } from "@pwqa/shared";

interface ProjectPickerProps {
  onProjectChange?: (summary: ProjectSummary | null) => void;
}

export function ProjectPicker({ onProjectChange }: ProjectPickerProps) {
  const queryClient = useQueryClient();
  const [path, setPath] = useState("");

  const currentQuery = useQuery({
    queryKey: ["projects", "current"],
    queryFn: async () => fetchCurrentProject()
  });

  const openMutation = useMutation({
    mutationFn: async (rootPath: string) => openProject(rootPath),
    onSuccess: (summary) => {
      queryClient.setQueryData(["projects", "current"], summary);
      onProjectChange?.(summary);
    }
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (path.trim()) {
      openMutation.mutate(path.trim());
    }
  };

  const project = currentQuery.data;
  const errorMessage =
    openMutation.error instanceof WorkbenchApiError
      ? `${openMutation.error.code}: ${openMutation.error.message}`
      : openMutation.error instanceof Error
        ? openMutation.error.message
        : null;

  return (
    <article className="panel">
      <p className="panelLabel">Project</p>
      <form className="picker" onSubmit={handleSubmit}>
        <label htmlFor="project-root" className="muted">
          Absolute path to a Playwright project
        </label>
        <div className="pickerRow">
          <input
            id="project-root"
            type="text"
            placeholder="/path/to/playwright-project"
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
          <button type="submit" disabled={openMutation.isPending}>
            {openMutation.isPending ? "Opening…" : "Open"}
          </button>
        </div>
      </form>
      {project ? (
        <ProjectFacts summary={project} />
      ) : (
        <p className="muted">No project is open. Provide a project root above.</p>
      )}
      {errorMessage ? <p className="errorBlock">{errorMessage}</p> : null}
    </article>
  );
}

function ProjectFacts({ summary }: { summary: ProjectSummary }) {
  return (
    <dl className="facts">
      <div>
        <dt>Root</dt>
        <dd>{summary.rootPath}</dd>
      </div>
      <div>
        <dt>Package manager</dt>
        <dd>
          {summary.packageManager.name}
          {" "}
          <span className="muted">({summary.packageManager.confidence})</span>
        </dd>
      </div>
      <div>
        <dt>Status</dt>
        <dd>
          {summary.blockingExecution ? (
            <span className="badge badgeBlocked">Blocked</span>
          ) : (
            <span className="badge badgeReady">Ready</span>
          )}
        </dd>
      </div>
      {summary.packageManager.errors.length > 0 ? (
        <div>
          <dt>Errors</dt>
          <dd>
            <ul>
              {summary.packageManager.errors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
      {summary.packageManager.warnings.length > 0 ? (
        <div>
          <dt>Warnings</dt>
          <dd>
            <ul>
              {summary.packageManager.warnings.map((warn) => (
                <li key={warn}>{warn}</li>
              ))}
            </ul>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
