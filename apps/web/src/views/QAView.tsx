import type { ProjectSummary, RunRequest } from "@pwqa/shared";
import { ProjectPicker } from "../features/project-picker/ProjectPicker";
import { TestInventoryPanel } from "../features/test-inventory/TestInventoryPanel";
import { RunControls } from "../features/run-controls/RunControls";
import { RunConsole } from "../features/run-console/RunConsole";
import { FailureReview } from "../features/failure-review/FailureReview";
import type { EventStream } from "../api/events";

interface QAViewProps {
  project: ProjectSummary | null;
  activeRunId: string | undefined;
  eventStream: EventStream;
  onRunStarted: (runId: string, request: RunRequest) => void;
}

export function QAView({ project, activeRunId, eventStream, onRunStarted }: QAViewProps) {
  return (
    <div className="view view-qa">
      <section className="col" aria-label="プロジェクト">
        <div className="col-header">
          <div className="col-title">プロジェクト</div>
          <div className="col-counter">{project ? "open" : "closed"}</div>
        </div>
        <div
          className="col-body"
          style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}
        >
          <ProjectPicker />
          {project ? <TestInventoryPanel project={project} /> : null}
        </div>
      </section>

      <section className="col" aria-label="テスト実行">
        <div className="col-header">
          <div className="col-title">テスト実行</div>
          <div className="col-counter">{activeRunId ? activeRunId.slice(0, 8) : "—"}</div>
        </div>
        <div
          className="col-body"
          style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}
        >
          <RunControls project={project} onRunStarted={onRunStarted} />
          <RunConsole eventStream={eventStream} activeRunId={activeRunId} />
        </div>
      </section>

      <aside className="col" aria-label="失敗レビュー">
        <div className="col-header">
          <div className="col-title">失敗レビュー</div>
          <div className="col-counter">{activeRunId ? "live" : "—"}</div>
        </div>
        <div
          className="col-body"
          style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}
        >
          <FailureReview runId={activeRunId} />
        </div>
      </aside>
    </div>
  );
}
