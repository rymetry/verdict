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

  const project = currentQuery.data ?? null;
  const errorMessage =
    openMutation.error instanceof WorkbenchApiError
      ? `${openMutation.error.code}: ${openMutation.error.message}`
      : openMutation.error instanceof Error
        ? openMutation.error.message
        : null;

  return (
    <div className="locator-card">
      <h4>プロジェクト</h4>
      <div>
        <form onSubmit={handleSubmit}>
          <label
            htmlFor="project-root"
            style={{
              display: "block",
              fontSize: 11,
              color: "var(--ink-3)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              marginBottom: 6
            }}
          >
            Absolute path to a Playwright project
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="project-root"
              type="text"
              placeholder="/path/to/playwright-project"
              value={path}
              onChange={(event) => setPath(event.target.value)}
              style={{
                flex: 1,
                padding: "8px 10px",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-1)",
                color: "var(--ink-0)",
                fontFamily: "var(--mono)",
                fontSize: 12
              }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={openMutation.isPending}
            >
              {openMutation.isPending ? "Opening…" : "Open"}
            </button>
          </div>
        </form>

        {project ? <ProjectFacts summary={project} /> : (
          <p
            className="muted"
            style={{ fontSize: 12, color: "var(--ink-3)", margin: "12px 0 0" }}
          >
            No project is open. Provide a project root above.
          </p>
        )}
        {errorMessage ? (
          <p className="errorBlock"
            style={{
              marginTop: 12,
              padding: "10px 12px",
              border: "1px solid color-mix(in oklch, var(--fail) 40%, transparent)",
              borderLeft: "3px solid var(--fail)",
              borderRadius: "var(--radius-sm)",
              background: "var(--fail-soft)",
              color: "var(--fail)",
              fontSize: 12
            }}
          >
            ✕ {errorMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ProjectFacts({ summary }: { summary: ProjectSummary }) {
  return (
    <dl className="kv" style={{ marginTop: 12 }}>
      <dt>Root</dt>
      <dd>{summary.rootPath}</dd>
      <dt>PM</dt>
      <dd>
        {summary.packageManager.name}
        {" "}
        <span style={{ color: "var(--ink-3)" }}>({summary.packageManager.confidence})</span>
      </dd>
      <dt>Status</dt>
      <dd>
        {summary.blockingExecution ? (
          <span className="badge failed">Blocked</span>
        ) : (
          <span className="badge passed">Ready</span>
        )}
      </dd>
      {summary.packageManager.errors.length > 0 ? (
        <>
          <dt>Errors</dt>
          <dd>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              {summary.packageManager.errors.map((err) => (
                <li key={err} style={{ color: "var(--fail)", fontSize: 11 }}>
                  · {err}
                </li>
              ))}
            </ul>
          </dd>
        </>
      ) : null}
      {summary.packageManager.warnings.length > 0 ? (
        <>
          <dt>Warnings</dt>
          <dd>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              {summary.packageManager.warnings.map((warn) => (
                <li key={warn} style={{ color: "var(--flaky)", fontSize: 11 }}>
                  · {warn}
                </li>
              ))}
            </ul>
          </dd>
        </>
      ) : null}
    </dl>
  );
}
