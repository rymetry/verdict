import { useQuery } from "@tanstack/react-query";
import { fetchRun } from "../../api/client";
import type { FailedTest } from "@pwqa/shared";

interface FailureReviewProps {
  runId?: string;
}

export function FailureReview({ runId }: FailureReviewProps) {
  const runQuery = useQuery({
    queryKey: ["runs", runId],
    queryFn: async () => (runId ? fetchRun(runId) : null),
    enabled: Boolean(runId),
    refetchInterval: 2000
  });

  if (!runId) {
    return (
      <article className="panel">
        <p className="panelLabel">Failure review</p>
        <p className="muted">Start a run to see failure detail here.</p>
      </article>
    );
  }

  return (
    <article className="panel">
      <p className="panelLabel">Failure review</p>
      {runQuery.isLoading ? (
        <p className="muted">Loading run metadata…</p>
      ) : runQuery.error ? (
        <p className="errorBlock">{(runQuery.error as Error).message}</p>
      ) : runQuery.data?.summary?.failedTests?.length ? (
        <FailedTestList failedTests={runQuery.data.summary.failedTests} />
      ) : (
        <p className="muted">
          {runQuery.data?.status === "passed"
            ? "All tests passed."
            : runQuery.data?.summary
              ? "No failed tests in this run."
              : "Waiting for run completion…"}
        </p>
      )}
    </article>
  );
}

function FailedTestList({ failedTests }: { failedTests: FailedTest[] }) {
  return (
    <ul className="failureList">
      {failedTests.map((test, index) => (
        <li key={`${test.testId ?? test.title}-${index}`}>
          <h3>{test.fullTitle ?? test.title}</h3>
          <p className="muted">
            {test.filePath ?? "unknown"}
            {test.line ? `:${test.line}` : ""}
            {test.durationMs !== undefined ? ` · ${(test.durationMs / 1000).toFixed(1)}s` : ""}
          </p>
          {test.message ? <pre className="failureMessage">{test.message}</pre> : null}
          {test.stack ? (
            <details>
              <summary>stack</summary>
              <pre className="stack">{test.stack}</pre>
            </details>
          ) : null}
          {test.attachments.length > 0 ? (
            <ul className="attachments">
              {test.attachments.map((attachment) => (
                <li key={attachment.path}>
                  <span className="badge">{attachment.kind}</span> {attachment.label} ·{" "}
                  <code>{attachment.path}</code>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
