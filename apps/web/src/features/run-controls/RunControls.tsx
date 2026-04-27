import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectSummary, RunRequest } from "@pwqa/shared";
import { startRun, WorkbenchApiError } from "../../api/client";
import { PlayIcon } from "../../components/icons";

interface RunControlsProps {
  project: ProjectSummary | null;
  onRunStarted: (runId: string, request: RunRequest) => void;
}

export function RunControls({ project, onRunStarted }: RunControlsProps) {
  const queryClient = useQueryClient();
  const [specPath, setSpecPath] = useState("");
  const [grep, setGrep] = useState("");

  const startMutation = useMutation({
    mutationFn: async (request: RunRequest) => {
      const response = await startRun(request);
      return { response, request };
    },
    onSuccess: ({ response, request }) => {
      onRunStarted(response.runId, request);
      void queryClient.invalidateQueries({ queryKey: ["runs"] });
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
      <div className="locator-card">
        <h4>テスト実行</h4>
        <div>
          <p className="muted-note">プロジェクトを開くと実行できます。</p>
        </div>
      </div>
    );
  }

  const blocked = project.blockingExecution;

  return (
    <div className="locator-card">
      <h4>テスト実行</h4>
      <div>
        <form
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
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <FormField label="Spec path (相対 / 任意)">
            <input
              type="text"
              placeholder="tests/auth.spec.ts"
              value={specPath}
              onChange={(event) => setSpecPath(event.target.value)}
              style={inputStyle}
            />
          </FormField>
          <FormField label="Grep pattern (任意)">
            <input
              type="text"
              placeholder="@smoke"
              value={grep}
              onChange={(event) => setGrep(event.target.value)}
              style={inputStyle}
            />
          </FormField>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={blocked || startMutation.isPending}
            style={{ alignSelf: "flex-start" }}
          >
            <PlayIcon />
            {startMutation.isPending ? "Starting…" : "Run Playwright"}
          </button>
        </form>
        {blocked ? (
          <p className="error-inline">
            パッケージマネージャの状態が解消されるまで run はブロックされます。
          </p>
        ) : null}
        {errorMessage ? <p className="error-inline">{errorMessage}</p> : null}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  background: "var(--bg-1)",
  color: "var(--ink-0)",
  fontFamily: "var(--mono)",
  fontSize: 12
};

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          color: "var(--ink-3)",
          letterSpacing: "0.04em",
          textTransform: "uppercase"
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
